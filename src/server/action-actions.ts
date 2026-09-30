"use server";

/** Server actions for the action drawer and "Create action" (BRD 12.1, 12.3 to 12.7). */
import { redirect } from "next/navigation";
import { withWorkspace } from "@/db/client";
import { createManualAction, draftForAction, dueDate, type ActionType, type DraftOutcome } from "@/domain/actions";
import {
  ActionFlowError, approveAndSend, approveDraft, dismissAction, markDone, markLinkedinSent, recordBlock, recordLawfulBasis, recordOutcome, saveDraft, sendAction, submitForApproval, updateAction, type FlowActor,
} from "@/domain/action-flow";
import type { Purpose } from "@/domain/checks";
import { getRequestContext, type RequestContext } from "@/lib/context";
import { execSearchOn } from "@/lib/packs";
import { ForbiddenError } from "@/lib/permissions";
import { deliverQueued } from "@/mail/notify";
import { ACTION_TYPE_LABELS } from "@/lib/format/labels";
import { localTime } from "@/lib/working-days";
import { parseActionFilters } from "./actions";
import { UUID_RE } from "./guards";

/** A YYYY-MM-DD from a date field, as 17:00 on that day in the workspace (due times are end of day). */
function dueFromField(value: string, timeZone: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? localTime(Number(m[1]), Number(m[2]), Number(m[3]), 17, 0, timeZone) : undefined;
}

async function actor(): Promise<{ ctx: RequestContext; actor: FlowActor }> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  return { ctx, actor: { workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role } };
}

/** Keeps the list filters across a decision; only known filter values survive. */
function listQuery(formData: FormData): string {
  const raw = new URLSearchParams(String(formData.get("back") ?? ""));
  const f = parseActionFilters(Object.fromEntries(raw.entries()));
  const q = new URLSearchParams();
  if (f.owner !== "me") q.set("owner", f.owner);
  if (f.status !== "open") q.set("status", f.status);
  if (f.priority) q.set("priority", String(f.priority));
  if (f.type) q.set("type", f.type);
  if (f.due) q.set("due", f.due);
  return q.toString();
}

function back(formData: FormData, actionId: string, notice: string): never {
  const q = listQuery(formData);
  redirect(`/actions?${q ? `${q}&` : ""}id=${actionId}&notice=${notice}`);
}

/** Runs a flow step and turns refusals into notices; anything unexpected is rethrown. */
async function run(formData: FormData, actionId: string, step: () => Promise<string>, workspaceId?: string): Promise<never> {
  if (!UUID_RE.test(actionId)) redirect("/actions?notice=flow_not_found");
  let notice: string;
  try {
    notice = await step();
  } catch (error) {
    if (workspaceId) await recordBlock(workspaceId, actionId, error);
    if (error instanceof ActionFlowError) back(formData, actionId, `flow_${error.code}`);
    if (error instanceof ForbiddenError) back(formData, actionId, "not_allowed");
    throw error;
  }
  back(formData, actionId, notice);
}

function draftNotice(outcome: DraftOutcome): string {
  if (outcome.kind === "drafted") return "redrafted";
  if (outcome.kind === "blocked") return "draft_blocked";
  return outcome.note.includes("budget") ? "draft_paused" : "draft_skipped";
}

export async function saveDraftAction(actionId: string, formData: FormData): Promise<void> {
  const { ctx, actor: a } = await actor();
  const edit = { subject: formData.has("subject") ? String(formData.get("subject")) : null, body: String(formData.get("body") ?? "") };
  const intent = String(formData.get("intent") ?? "save");
  await run(formData, actionId, async () => {
    const saved = await withWorkspace(ctx.workspace.id, (tx) => saveDraft(tx, a, actionId, edit));
    if (intent === "submit") {
      await withWorkspace(ctx.workspace.id, (tx) => submitForApproval(tx, a, actionId));
      return "submitted";
    }
    if (intent === "approve") {
      await withWorkspace(ctx.workspace.id, (tx) => approveDraft(tx, a, actionId));
      return "approved";
    }
    if (intent === "approve_send") {
      await approveAndSend(a, actionId);
      return "sent";
    }
    if (intent === "send") {
      await sendAction(a, actionId);
      return "sent";
    }
    if (intent === "linkedin_sent") {
      await withWorkspace(ctx.workspace.id, (tx) => markLinkedinSent(tx, a, actionId));
      return "linkedin_sent";
    }
    return saved.changed ? "draft_saved" : "draft_unchanged";
  }, ctx.workspace.id);
}

export async function redraftAction(actionId: string, formData: FormData): Promise<void> {
  const { ctx, actor: a } = await actor();
  const purpose = String(formData.get("purpose") ?? "");
  const channel = String(formData.get("channel") ?? "");
  await run(formData, actionId, async () => {
    if (a.role !== "partner" && a.role !== "outreach_owner") throw new ForbiddenError("messages.send");
    const outcome = await draftForAction(ctx.workspace.id, actionId, {
      instruction: String(formData.get("instruction") ?? ""),
      purpose: purpose === "candidate" || purpose === "client" ? (purpose as Purpose) : undefined,
      channel: channel === "email" || channel === "linkedin_message" ? channel : undefined,
    });
    return draftNotice(outcome);
  });
}

export async function markDoneAction(actionId: string, formData: FormData): Promise<void> {
  const { ctx, actor: a } = await actor();
  await run(formData, actionId, async () => {
    await withWorkspace(ctx.workspace.id, (tx) => markDone(tx, a, actionId));
    return "action_done";
  });
}

export async function dismissActionAction(actionId: string, formData: FormData): Promise<void> {
  const { ctx, actor: a } = await actor();
  await run(formData, actionId, async () => {
    await withWorkspace(ctx.workspace.id, (tx) => dismissAction(tx, a, actionId, String(formData.get("reason") ?? "")));
    return "action_dismissed";
  });
}

export async function recordOutcomeAction(actionId: string, formData: FormData): Promise<void> {
  const { ctx, actor: a } = await actor();
  await run(formData, actionId, async () => {
    await withWorkspace(ctx.workspace.id, (tx) => recordOutcome(tx, a, actionId, String(formData.get("outcome") ?? "")));
    return "outcome_recorded";
  });
}

export async function updateActionAction(actionId: string, formData: FormData): Promise<void> {
  const { ctx, actor: a } = await actor();
  const type = String(formData.get("type") ?? "");
  const owner = String(formData.get("owner") ?? "");
  const due = String(formData.get("due") ?? "");
  await run(formData, actionId, async () => {
    const dueAt = dueFromField(due, ctx.workspace.timezone);
    await withWorkspace(ctx.workspace.id, (tx) =>
      updateAction(tx, a, actionId, { type: type in ACTION_TYPE_LABELS ? (type as ActionType) : undefined, ownerUserId: UUID_RE.test(owner) ? owner : undefined, dueAt }),
    );
    return "action_updated";
  });
}

export async function recordLawfulBasisAction(actionId: string, personId: string, formData: FormData): Promise<void> {
  const { ctx, actor: a } = await actor();
  await run(formData, actionId, async () => {
    if (!UUID_RE.test(personId)) throw new ActionFlowError("not_found", "That person is not in this workspace.");
    const needDraft = await withWorkspace(ctx.workspace.id, (tx) => recordLawfulBasis(tx, a, personId, String(formData.get("note") ?? "")));
    for (const id of needDraft) await draftForAction(ctx.workspace.id, id).catch(() => undefined);
    return "lawful_basis_recorded";
  });
}

/** "Create action" on a person page (BRD 12.1). The due date defaults to the priority 2 service level. */
export async function createActionForPersonAction(personId: string, formData: FormData): Promise<void> {
  const { ctx, actor: a } = await actor();
  if (!UUID_RE.test(personId)) redirect("/people");
  if (a.role !== "partner" && a.role !== "outreach_owner") redirect(`/people/${personId}?notice=not_allowed`);
  const type = String(formData.get("type") ?? "check_in");
  const purpose: Purpose = execSearchOn(ctx.workspace) && formData.get("purpose") === "candidate" ? "candidate" : "client";
  const owner = String(formData.get("owner") ?? "");
  const due = String(formData.get("due") ?? "");
  const now = new Date();
  const created = await withWorkspace(ctx.workspace.id, (tx) =>
    createManualAction(tx, a, {
      personId,
      type: type in ACTION_TYPE_LABELS ? (type as ActionType) : "check_in",
      purpose,
      ownerUserId: UUID_RE.test(owner) ? owner : a.userId,
      dueAt: dueFromField(due, ctx.workspace.timezone) ?? dueDate({ priority: 2, type: "other", effectiveOn: null }, now, ctx.workspace.settings, ctx.workspace.timezone),
      headline: String(formData.get("headline") ?? "").trim().slice(0, 140) || null,
    }),
  );
  if ("refused" in created) redirect(`/people/${personId}?notice=action_refused`);
  if (created.needsDraft) await draftForAction(ctx.workspace.id, created.actionId).catch(() => undefined);
  await deliverQueued(ctx.workspace.id).catch(() => undefined);
  redirect(`/actions?owner=all&id=${created.actionId}&notice=action_created`);
}
