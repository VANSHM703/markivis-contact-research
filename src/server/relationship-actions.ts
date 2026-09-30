"use server";

/** Connections, introduction requests, and scoring weights and calibration (BRD 11.4, 11.6, 11.7). */
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/forms/FormState";
import { withWorkspace } from "@/db/client";
import { persons, workspaces } from "@/db/schema";
import { addManualConnection, MANUAL_WEIGHTS, removeManualConnection, type ManualType } from "@/domain/connections";
import { createManualAction, draftForAction, dueDate } from "@/domain/actions";
import { findPaths } from "@/domain/paths";
import { recomputeScores } from "@/domain/relationships";
import { audit } from "@/lib/audit";
import { getRequestContext, type RequestContext } from "@/lib/context";
import { can, type Capability } from "@/lib/permissions";
import { localDate } from "@/lib/working-days";
import { UUID_RE } from "./guards";

async function need(capability: Capability): Promise<RequestContext> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!can(ctx.role, capability)) redirect("/?notice=not_allowed");
  return ctx;
}
const actorOf = (ctx: RequestContext) => ({ workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role });

export async function addConnectionAction(personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await need("records.edit");
  if (!UUID_RE.test(personId)) redirect("/people");
  const otherId = String(formData.get("other_id") ?? "");
  const type = String(formData.get("type") ?? "") as ManualType;
  const note = String(formData.get("note") ?? "");
  const fieldErrors: Record<string, string> = {};
  if (!UUID_RE.test(otherId) || otherId === personId) fieldErrors.other_id = "Choose the other person from the list.";
  if (!(type in MANUAL_WEIGHTS)) fieldErrors.type = "Choose how they know each other.";
  if (Object.keys(fieldErrors).length) return { message: `Check ${Object.keys(fieldErrors).length === 1 ? "this field" : "these fields"}.`, fieldErrors, values: { type, note } };
  await withWorkspace(ctx.workspace.id, (tx) => addManualConnection(tx, actorOf(ctx), { personId, otherId, type, note }));
  redirect(`/people/${personId}?tab=connections&notice=connection_added`);
}

export async function removeConnectionAction(personId: string, connectionId: string): Promise<void> {
  const ctx = await need("records.edit");
  if (!UUID_RE.test(personId) || !UUID_RE.test(connectionId)) redirect("/people");
  await withWorkspace(ctx.workspace.id, (tx) => removeManualConnection(tx, actorOf(ctx), connectionId));
  redirect(`/people/${personId}?tab=connections&notice=connection_removed`);
}

/**
 * "Draft introduction request" (BRD 11.7): an action written to the connector, not the target,
 * carrying the path so the draft can use the connection (BRD 17.3).
 */
export async function draftIntroductionAction(targetId: string, connectorId: string): Promise<void> {
  const ctx = await need("messages.send");
  if (!UUID_RE.test(targetId) || !UUID_RE.test(connectorId)) redirect("/paths");
  const today = localDate(new Date(), ctx.workspace.timezone);
  const created = await withWorkspace(ctx.workspace.id, async (tx) => {
    const path = (await findPaths(tx, targetId, today)).find((p) => p.connector_person_id === connectorId);
    const [target] = await tx.select({ name: persons.fullName }).from(persons).where(eq(persons.id, targetId)).limit(1);
    if (!path || !target) return null;
    return createManualAction(tx, actorOf(ctx), {
      personId: connectorId,
      type: "introduction_request",
      purpose: "client",
      ownerUserId: path.owner_user_id ?? ctx.user.id,
      dueAt: dueDate({ priority: 2, type: "other", effectiveOn: null }, new Date(), ctx.workspace.settings, ctx.workspace.timezone),
      headline: `Ask ${path.connector_name} for an introduction to ${target.name}`.slice(0, 140),
      bestPath: { ...path, target_person_id: targetId, target_name: target.name },
    });
  });
  if (!created || "refused" in created) redirect(`/paths?person=${targetId}&notice=action_refused`);
  if (created.needsDraft) await draftForAction(ctx.workspace.id, created.actionId).catch(() => undefined);
  redirect(`/actions?owner=all&id=${created.actionId}&notice=action_created`);
}

const WEIGHT_KEYS = ["recency", "frequency", "reciprocity", "depth", "tenure"] as const;
const BAND_KEYS = ["strong", "warm", "cooling", "cold"] as const;

/** Saves weights and band thresholds, then recomputes every score (BRD 11.4). Partner only. */
export async function saveScoringAction(formData: FormData): Promise<void> {
  const ctx = await need("settings.change");
  if (ctx.role !== "partner") redirect("/settings/scoring?notice=not_allowed");
  const weights = Object.fromEntries(WEIGHT_KEYS.map((k) => [k, Number(formData.get(`w_${k}`))])) as Record<(typeof WEIGHT_KEYS)[number], number>;
  const bands = Object.fromEntries(BAND_KEYS.map((k) => [k, Number(formData.get(`b_${k}`))])) as Record<(typeof BAND_KEYS)[number], number>;
  const sum = WEIGHT_KEYS.reduce((s, k) => s + weights[k], 0);
  const okWeights = WEIGHT_KEYS.every((k) => Number.isFinite(weights[k]) && weights[k] >= 0 && weights[k] <= 1) && Math.abs(sum - 1) < 0.001;
  const okBands = BAND_KEYS.every((k) => Number.isInteger(bands[k])) && bands.strong <= 100 && bands.strong > bands.warm && bands.warm > bands.cooling && bands.cooling > bands.cold && bands.cold >= 1;
  if (!okWeights || !okBands) redirect(`/settings/scoring?notice=${okWeights ? "bands_invalid" : "weights_invalid"}`);
  await withWorkspace(ctx.workspace.id, async (tx) => {
    const [ws] = await tx.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, ctx.workspace.id)).limit(1);
    const before = ws!.settings as Record<string, unknown>;
    const scoring = { ...((before.scoring ?? {}) as object), weights, bands };
    await tx.update(workspaces).set({ settings: { ...before, scoring } }).where(eq(workspaces.id, ctx.workspace.id));
    await audit(tx, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, actorKind: "user", action: "settings.scoring_changed", entityType: "workspace", entityId: ctx.workspace.id, before: { scoring: before.scoring }, after: { weights, bands } });
  });
  await recomputeScores(ctx.workspace.id);
  redirect("/settings/scoring?notice=scoring_saved");
}

/** Stores the partner's blind ranking of people they know well (BRD 11.4 calibration). */
export async function saveCalibrationAction(formData: FormData): Promise<void> {
  const ctx = await need("settings.change");
  if (ctx.role !== "partner") redirect("/settings/scoring?notice=not_allowed");
  const ranks: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    const m = /^rank_([0-9a-f-]{36})$/i.exec(key);
    const n = Number(value);
    if (m && Number.isInteger(n) && n >= 1 && n <= 30) ranks[m[1]!] = n;
  }
  const values = Object.values(ranks);
  if (values.length < 5 || new Set(values).size !== values.length) redirect("/settings/scoring?tab=calibration&notice=calibration_invalid");
  await withWorkspace(ctx.workspace.id, async (tx) => {
    const [ws] = await tx.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, ctx.workspace.id)).limit(1);
    const before = ws!.settings as Record<string, unknown>;
    const scoring = { ...((before.scoring ?? {}) as object), calibration: { ranks, at: new Date().toISOString(), by: ctx.user.id } };
    await tx.update(workspaces).set({ settings: { ...before, scoring } }).where(eq(workspaces.id, ctx.workspace.id));
    await audit(tx, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, actorKind: "user", action: "settings.calibration_saved", entityType: "workspace", entityId: ctx.workspace.id, after: { people: values.length } });
  });
  redirect("/settings/scoring?tab=calibration&notice=calibration_saved");
}
