"use server";

/** Resolving conflicts and possible duplicates from the queue (BRD 10.4). */
import { redirect } from "next/navigation";
import { aiMode } from "@/ai/adapter";
import { SIGNAL_TYPES } from "@/ai/contracts";
import { withWorkspace } from "@/db/client";
import { draftForAction } from "@/domain/actions";
import { QueueItemError, resolveConflict, resolveDuplicate } from "@/domain/queue-items";
import { enqueueQuietly } from "@/jobs/enqueue";
import {
  approveBatch, completeResearch, confirmSignal, markSpotCheck, parkSignal, reenableAutoConfirm, rejectSignal, requestResearch, ValidationError,
  type RejectReason, type SignalEdits,
} from "@/pipeline/validation";
import { nextInTab } from "./queue";
import { getRequestContext } from "@/lib/context";
import { can } from "@/lib/permissions";

async function requireValidator() {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!can(ctx.role, "queue.work")) redirect("/?notice=not_allowed");
  return ctx;
}

export async function resolveConflictAction(itemId: string, formData: FormData): Promise<void> {
  const ctx = await requireValidator();
  const chosen = String(formData.get("field_source_id") ?? "");
  try {
    await withWorkspace(ctx.workspace.id, (tx) => resolveConflict(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, itemId, chosen));
  } catch (error) {
    if (error instanceof QueueItemError) redirect("/queue?tab=conflicts&notice=item_gone");
    throw error;
  }
  redirect("/queue?tab=conflicts&notice=conflict_resolved");
}

export async function resolveDuplicateAction(itemId: string, formData: FormData): Promise<void> {
  const ctx = await requireValidator();
  if (!can(ctx.role, "persons.merge")) redirect("/queue?tab=conflicts&notice=not_allowed");
  const decision = String(formData.get("decision") ?? "");
  try {
    await withWorkspace(ctx.workspace.id, (tx) =>
      resolveDuplicate(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, itemId, decision === "keep_separate" ? { merge: false } : { merge: true, survivorId: decision }),
    );
  } catch (error) {
    if (error instanceof QueueItemError) redirect("/queue?tab=conflicts&notice=item_gone");
    throw error;
  }
  redirect(`/queue?tab=conflicts&notice=${decision === "keep_separate" ? "kept_separate" : "duplicate_merged"}`);
}

// ---------------------------------------------------------------------------------------------
// Signal decisions (BRD 10.2, 10.5, 10.6)
// ---------------------------------------------------------------------------------------------

type Tab = "review" | "batch" | "research" | "parked" | "spot" | "shadow";

async function afterDecision(workspaceId: string, tab: Tab, decidedId: string, notice: string): Promise<never> {
  const next = await nextInTab(workspaceId, tab, decidedId);
  redirect(`/queue?tab=${tab}&notice=${notice}${next ? `&item=${next}` : ""}`);
}

function editsFrom(formData: FormData): SignalEdits {
  const text = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v || undefined;
  };
  const edits: SignalEdits = {};
  const headline = text("headline");
  if (headline) edits.headline = headline.slice(0, 140);
  const priority = Number(text("priority"));
  if ([1, 2, 3].includes(priority)) edits.priority = priority as 1 | 2 | 3;
  const confidence = text("confidence");
  if (confidence === "high" || confidence === "medium" || confidence === "low") edits.confidence = confidence;
  const type = text("type");
  if (type && (SIGNAL_TYPES as readonly string[]).includes(type)) edits.type = type as SignalEdits["type"];
  for (const k of ["event_on", "effective_on"] as const) {
    const v = text(k);
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) edits[k === "event_on" ? "eventOn" : "effectiveOn"] = v;
  }
  return edits;
}

export async function confirmSignalAction(signalId: string, tab: Tab, formData: FormData): Promise<void> {
  const ctx = await requireValidator();
  const actor = { workspaceId: ctx.workspace.id, userId: ctx.user.id };
  let actionId: string | null = null;
  try {
    const result = await withWorkspace(ctx.workspace.id, (tx) => confirmSignal(tx, actor, signalId, { edits: editsFrom(formData) }));
    actionId = result.action?.needsDraft ? result.action.actionId : null;
  } catch (error) {
    if (error instanceof ValidationError) redirect(`/queue?tab=${tab}&notice=item_gone`);
    throw error;
  }
  if (actionId) await draftForAction(ctx.workspace.id, actionId).catch(() => undefined);
  await afterDecision(ctx.workspace.id, tab, signalId, "signal_confirmed");
}

export async function rejectSignalAction(signalId: string, tab: Tab, formData: FormData): Promise<void> {
  const ctx = await requireValidator();
  const reason = String(formData.get("reason") ?? "") as RejectReason;
  try {
    await withWorkspace(ctx.workspace.id, (tx) => rejectSignal(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, signalId, reason));
  } catch (error) {
    if (error instanceof ValidationError) redirect(`/queue?tab=${tab}&notice=item_gone`);
    throw error;
  }
  await afterDecision(ctx.workspace.id, tab, signalId, `signal_rejected_${reason}`);
}

export async function researchSignalAction(signalId: string, tab: Tab): Promise<void> {
  const ctx = await requireValidator();
  try {
    await withWorkspace(ctx.workspace.id, (tx) => requestResearch(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, signalId));
  } catch (error) {
    if (error instanceof ValidationError) redirect(`/queue?tab=${tab}&item=${signalId}&notice=research_limit`);
    throw error;
  }
  // Mock research is instant; live research can take a minute, so it runs on the worker.
  if (aiMode() === "mock") await completeResearch(ctx.workspace.id, signalId);
  else await enqueueQuietly("pipeline.research", { workspaceId: ctx.workspace.id, signalId });
  await afterDecision(ctx.workspace.id, tab, signalId, aiMode() === "mock" ? "research_done" : "research_queued");
}

export async function parkSignalAction(signalId: string, tab: Tab): Promise<void> {
  const ctx = await requireValidator();
  try {
    await withWorkspace(ctx.workspace.id, (tx) => parkSignal(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, signalId));
  } catch (error) {
    if (error instanceof ValidationError) redirect(`/queue?tab=${tab}&notice=item_gone`);
    throw error;
  }
  await afterDecision(ctx.workspace.id, tab, signalId, "signal_parked");
}

export async function approveBatchAction(formData: FormData): Promise<void> {
  const ctx = await requireValidator();
  const ids = formData.getAll("signal_id").map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const result = await withWorkspace(ctx.workspace.id, (tx) => approveBatch(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, ids));
  for (const a of result.actions) if (a.needsDraft) await draftForAction(ctx.workspace.id, a.actionId).catch(() => undefined);
  redirect(`/queue?tab=batch&notice=batch_approved&count=${result.confirmed}`);
}

export async function spotCheckAction(signalId: string, formData: FormData): Promise<void> {
  const ctx = await requireValidator();
  const result = String(formData.get("result")) === "incorrect" ? "incorrect" : "correct";
  const suspended = await withWorkspace(ctx.workspace.id, (tx) => markSpotCheck(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, signalId, result));
  if (suspended.length) redirect(`/queue?tab=spot&notice=auto_confirm_suspended`);
  await afterDecision(ctx.workspace.id, "spot", signalId, "spot_check_recorded");
}

export async function reenableAutoConfirmAction(sourceType: string): Promise<void> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!can(ctx.role, "settings.change")) redirect("/?notice=not_allowed");
  await withWorkspace(ctx.workspace.id, (tx) => reenableAutoConfirm(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, sourceType));
  redirect("/?notice=auto_confirm_reenabled");
}
