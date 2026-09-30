"use server";

/**
 * Executive search pack actions (BRD 13): off-limits rules, placements, confidential mandate notes,
 * their CSV imports, and switching packs on or off (platform admins). Every action refuses when the
 * pack is off, so a switched-off pack cannot be used through a stale page.
 */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/forms/FormState";
import { withSystem, withWorkspace } from "@/db/client";
import { importBatches, workspaces } from "@/db/schema";
import { CsvError } from "@/domain/imports/csv";
import { commitPack, IMPORT_PATH, previewPack, readPackFile, type PackImportKind, type PackPreviewRow, type PackPreviewSummary } from "@/domain/imports/pack";
import { ImportFileError, MAX_IMPORT_BYTES } from "@/domain/imports/target-list";
import { addMandateNote, NoteTooShortError, type NoteTarget } from "@/domain/mandate-notes";
import { addOffLimitsRule, endOffLimitsRule, offLimitsSchema } from "@/domain/off-limits";
import { addPlacement, DuplicatePlacementError, placementSchema } from "@/domain/placements";
import type { SourceNote } from "@/domain/records";
import { audit } from "@/lib/audit";
import { getRequestContext, type RequestContext } from "@/lib/context";
import { execSearchOn } from "@/lib/packs";
import { can, type Capability } from "@/lib/permissions";
import { localDate } from "@/lib/working-days";
import { formObject, invalidAll, parseForm, sourceSchema } from "./forms";
import { UUID_RE } from "./guards";

async function requirePack(capability: Capability): Promise<RequestContext> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!execSearchOn(ctx.workspace)) redirect("/?notice=pack_off");
  if (!can(ctx.role, capability)) redirect("/?notice=not_allowed");
  return ctx;
}

const actorOf = (ctx: RequestContext) => ({ workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role });
const OFF_LIMITS = "/settings/off-limits";

// ---------------------------------------------------------------------------------------------
// Off-limits rules (partner only)
// ---------------------------------------------------------------------------------------------

const RULE_FIELDS: Record<string, string> = { companyId: "company_id", scope: "scope", function: "function", minSeniority: "min_seniority", reason: "reason", startsOn: "starts_on", endsOn: "ends_on" };

export async function addOffLimitsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requirePack("off_limits.set");
  const raw = formObject(formData);
  const parsed = offLimitsSchema.safeParse({
    companyId: String(raw.company_id ?? ""),
    scope: String(raw.scope ?? ""),
    function: String(raw.function ?? "") || undefined,
    minSeniority: String(raw.min_seniority ?? "") || null,
    reason: String(raw.reason ?? ""),
    startsOn: String(raw.starts_on ?? ""),
    endsOn: String(raw.ends_on ?? "") || null,
  });
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [RULE_FIELDS[String(i.path[0])] ?? String(i.path[0]), i.message]));
    return { message: `Check ${Object.keys(fieldErrors).length === 1 ? "this field" : "these fields"}: ${Object.keys(fieldErrors).join(", ").replace(/_/g, " ")}.`, fieldErrors, values: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? "")])) };
  }
  await withWorkspace(ctx.workspace.id, (tx) => addOffLimitsRule(tx, actorOf(ctx), parsed.data));
  redirect(`${OFF_LIMITS}?notice=off_limits_added`);
}

export async function endOffLimitsAction(ruleId: string): Promise<void> {
  const ctx = await requirePack("off_limits.set");
  if (!UUID_RE.test(ruleId)) redirect(OFF_LIMITS);
  await withWorkspace(ctx.workspace.id, (tx) => endOffLimitsRule(tx, actorOf(ctx), ruleId, localDate(new Date(), ctx.workspace.timezone)));
  redirect(`${OFF_LIMITS}?notice=off_limits_ended`);
}

// ---------------------------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------------------------

export async function addPlacementAction(personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requirePack("records.edit");
  const raw = formObject(formData);
  const parsed = placementSchema.safeParse({ personId, companyId: String(raw.company_id ?? ""), roleTitle: String(raw.role_title ?? ""), placedOn: String(raw.placed_on ?? ""), searchReference: String(raw.search_reference ?? "") });
  const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? "")]));
  if (!parsed.success) {
    const map: Record<string, string> = { companyId: "company_id", roleTitle: "role_title", placedOn: "placed_on", searchReference: "search_reference" };
    const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [map[String(i.path[0])] ?? String(i.path[0]), i.message]));
    return { message: `Check ${Object.keys(fieldErrors).length === 1 ? "this field" : "these fields"}: ${Object.keys(fieldErrors).join(", ").replace(/_/g, " ")}.`, fieldErrors, values };
  }
  try {
    await withWorkspace(ctx.workspace.id, (tx) => addPlacement(tx, actorOf(ctx), parsed.data));
  } catch (error) {
    if (error instanceof DuplicatePlacementError) return { message: error.message, values };
    throw error;
  }
  redirect(`/people/${personId}?notice=placement_added`);
}

// ---------------------------------------------------------------------------------------------
// Confidential mandate notes (partner only)
// ---------------------------------------------------------------------------------------------

export async function addMandateNoteAction(kind: "person" | "company", id: string, formData: FormData): Promise<void> {
  const ctx = await requirePack("mandate_notes.view");
  if (!UUID_RE.test(id)) redirect("/");
  const target: NoteTarget = kind === "person" ? { personId: id } : { companyId: id };
  const back = kind === "person" ? `/people/${id}?tab=notes` : `/companies/${id}`;
  try {
    await withWorkspace(ctx.workspace.id, (tx) => addMandateNote(tx, actorOf(ctx), target, String(formData.get("body") ?? "")));
  } catch (error) {
    if (error instanceof NoteTooShortError) redirect(`${back}${back.includes("?") ? "&" : "?"}notice=note_invalid`);
    throw error;
  }
  redirect(`${back}${back.includes("?") ? "&" : "?"}notice=note_added`);
}

// ---------------------------------------------------------------------------------------------
// Imports: placements and off-limits rules (BRD 16.4)
// ---------------------------------------------------------------------------------------------

const IMPORT_CAPABILITY: Record<PackImportKind, Capability> = { placements: "records.edit", off_limits: "off_limits.set" };

export interface StoredPackBatch {
  rows: PackPreviewRow[];
  summary: PackPreviewSummary;
  source: SourceNote;
}

export async function uploadPackImportAction(kind: PackImportKind, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requirePack(IMPORT_CAPABILITY[kind]);
  const raw = formObject(formData);
  const source = parseForm(sourceSchema, raw);
  const file = formData.get("file");
  const fileProblem = !(file instanceof File) || file.size === 0 ? "Choose a CSV file to upload." : file.size > MAX_IMPORT_BYTES ? "The file is larger than 5 MB. Split it into smaller files." : null;
  const problems = invalidAll([source], raw, fileProblem ? { file: fileProblem } : {});
  if (problems || !source.success || !(file instanceof File)) return problems!;
  let parsed;
  try {
    parsed = readPackFile(kind, await file.text());
  } catch (error) {
    if (error instanceof ImportFileError || error instanceof CsvError) return { message: "Check this field: file.", fieldErrors: { file: error.message } };
    throw error;
  }
  const batchId = await withWorkspace(ctx.workspace.id, async (tx) => {
    const preview = await previewPack(tx, ctx.workspace.id, kind, parsed.rows, parsed.unknownColumns);
    const stored: StoredPackBatch = { rows: preview.rows, summary: preview.summary, source: { sourceType: source.data.source_type, note: source.data.source_note, sourceUrl: source.data.source_url } };
    const [batch] = await tx.insert(importBatches).values({ workspaceId: ctx.workspace.id, kind, filename: file.name.slice(0, 200), rows: stored, createdBy: ctx.user.id }).returning({ id: importBatches.id });
    return batch!.id;
  });
  redirect(`${IMPORT_PATH[kind]}/${batchId}`);
}

export async function commitPackImportAction(kind: PackImportKind, batchId: string): Promise<void> {
  const ctx = await requirePack(IMPORT_CAPABILITY[kind]);
  const outcome = await withWorkspace(ctx.workspace.id, async (tx) => {
    const [batch] = await tx.select().from(importBatches).where(and(eq(importBatches.id, batchId), eq(importBatches.kind, kind), eq(importBatches.status, "previewed"))).limit(1);
    if (!batch) return "gone" as const;
    const stored = batch.rows as StoredPackBatch;
    const report = await commitPack(tx, actorOf(ctx), kind, batchId, stored.rows, stored.source);
    await tx.update(importBatches).set({ status: "committed", report, committedAt: new Date() }).where(eq(importBatches.id, batchId));
    await audit(tx, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, actorKind: "user", action: "import.committed", entityType: "import_batch", entityId: batchId, after: { kind, ...report } });
    return "done" as const;
  });
  redirect(`${IMPORT_PATH[kind]}/${batchId}?notice=${outcome === "gone" ? "import_already_done" : "import_committed"}`);
}

export async function discardPackImportAction(kind: PackImportKind, batchId: string): Promise<void> {
  const ctx = await requirePack(IMPORT_CAPABILITY[kind]);
  await withWorkspace(ctx.workspace.id, (tx) => tx.update(importBatches).set({ status: "discarded" }).where(and(eq(importBatches.id, batchId), eq(importBatches.kind, kind), eq(importBatches.status, "previewed"))));
  redirect(`${IMPORT_PATH[kind]}?notice=import_discarded`);
}

// ---------------------------------------------------------------------------------------------
// Packs (platform admins only, BRD 5.3 and 16.2)
// ---------------------------------------------------------------------------------------------

export async function setPacksAction(formData: FormData): Promise<void> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!ctx.user.isPlatformAdmin) redirect("/?notice=not_allowed");
  const execSearch = formData.get("exec_search") === "on";
  const peMapping = formData.get("pe_mapping") === "on";
  const hubspot = formData.get("crm_hubspot") === "on";
  await withSystem("platform_admin", async (tx) => {
    const [ws] = await tx.select({ packs: workspaces.packs, flags: workspaces.flags }).from(workspaces).where(eq(workspaces.id, ctx.workspace.id)).limit(1);
    const before = { packs: ws!.packs, flags: ws!.flags };
    const packs = { ...(ws!.packs as object), exec_search: execSearch, pe_mapping: peMapping };
    const flags = { ...(ws!.flags as object), "pack.exec_search": execSearch, "pack.pe_mapping": peMapping, "crm.hubspot": hubspot };
    await tx.update(workspaces).set({ packs, flags }).where(eq(workspaces.id, ctx.workspace.id));
    await audit(tx, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, actorKind: "platform_admin", action: "workspace.packs_changed", entityType: "workspace", entityId: ctx.workspace.id, before, after: { packs, flags } });
  });
  redirect("/settings/packs?notice=packs_saved");
}
