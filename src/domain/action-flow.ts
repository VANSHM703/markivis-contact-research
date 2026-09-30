/**
 * The action flow after creation (BRD 12.4 to 12.7): editing drafts, submitting for approval,
 * approving, sending (email from the approving partner's mailbox, LinkedIn by hand), marking
 * done, dismissing, outcomes, and recording a lawful basis. Every step is audited.
 *
 * Status flow: open, drafted, awaiting_approval (an outreach owner submits), approved (partner),
 * sent, done. The partner can approve and send in one step. Any new draft version resets the
 * action to drafted, so what is sent is always the version that was approved.
 */
import { and, count, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { withWorkspace, type Tx } from "@/db/client";
import { actions, consents, drafts, interactions, persons, roles, users, workspaceMembers, workspaces } from "@/db/schema";
import { audit } from "@/lib/audit";
import { assertCan, type Capability } from "@/lib/permissions";
import { startOfLocalDay, localDate } from "@/lib/working-days";
import type { WorkspaceRole } from "@/config/navigation";
import { getMailboxSender, SendError, type MailboxSender } from "@/outreach/mailbox";
import { OPEN_STATUSES } from "./actions";
import { BLOCK_NOTES, evaluateChecks, loadCheckFacts } from "./checks";

export interface FlowActor {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

export type FlowErrorCode =
  | "closed"
  | "blocked"
  | "no_draft"
  | "not_approved"
  | "flagged_draft"
  | "rate_limit"
  | "no_email"
  | "no_mailbox"
  | "send_failed"
  | "wrong_channel"
  | "not_found"
  | "no_person"
  | "empty_body"
  | "no_subject"
  | "no_reason"
  | "no_outcome"
  | "not_sent"
  | "bad_owner"
  | "short_note"
  | "opted_out";

/** A refusal the interface shows as-is. Messages follow BRD 16.5: what happened and how to fix it. */
export class ActionFlowError extends Error {
  constructor(
    public readonly code: FlowErrorCode,
    message: string,
    /** For a failed pre-action check: the note to keep on the action (see recordBlock). */
    public readonly blockedNote?: string,
  ) {
    super(message);
  }
}

/**
 * Keeps a send-time check failure on the action. The step that found it throws, which rolls its
 * own transaction back, so the note is written in a separate one.
 */
export async function recordBlock(workspaceId: string, actionId: string, error: unknown): Promise<void> {
  if (!(error instanceof ActionFlowError) || !error.blockedNote) return;
  await withWorkspace(workspaceId, (tx) => tx.update(actions).set({ blockedReason: error.blockedNote }).where(eq(actions.id, actionId)));
}

export const DISMISS_REASONS = ["not_relevant", "already_known", "wrong_timing", "off_limits"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];
export const OUTCOMES = ["no_reply", "replied", "meeting", "mandate"] as const;
export type Outcome = (typeof OUTCOMES)[number];

type ActionRow = typeof actions.$inferSelect;
type DraftRow = typeof drafts.$inferSelect;

function can(actor: FlowActor, capability: Capability) {
  assertCan(actor.role, capability);
}

async function loadAction(tx: Tx, actionId: string): Promise<ActionRow> {
  const [action] = await tx.select().from(actions).where(eq(actions.id, actionId)).limit(1);
  if (!action) throw new ActionFlowError("not_found", "That action is not in this workspace.");
  return action;
}

function assertOpen(action: ActionRow) {
  if (!(OPEN_STATUSES as readonly string[]).includes(action.status)) throw new ActionFlowError("closed", "This action is already closed.");
}

export async function latestDraft(tx: Tx, actionId: string): Promise<DraftRow | null> {
  const [draft] = await tx.select().from(drafts).where(eq(drafts.actionId, actionId)).orderBy(desc(drafts.version)).limit(1);
  return draft ?? null;
}

async function setStatus(tx: Tx, actor: FlowActor, action: ActionRow, status: ActionRow["status"], event: string, after: Record<string, unknown> = {}) {
  await tx.update(actions).set({ status }).where(eq(actions.id, action.id));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: event, entityType: "action", entityId: action.id, before: { status: action.status }, after: { status, ...after } });
}

/** Re-runs checks 1 to 4 (BRD 12.5: at send time, not only at draft time). */
async function assertChecksPass(tx: Tx, actor: FlowActor, action: ActionRow, channel: DraftRow["channel"]) {
  if (!action.personId) throw new ActionFlowError("no_person", "This action has no person yet. Choose who to contact first.");
  const [ws] = await tx.select({ timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, actor.workspaceId)).limit(1);
  const facts = await loadCheckFacts(tx, actor.workspaceId, action.personId);
  const check = facts ? evaluateChecks(facts, action.purpose, localDate(new Date(), ws!.timezone), channel) : null;
  if (!check || check.kind === "no_action") throw new ActionFlowError("blocked", "This person must not be contacted, so nothing can be sent.");
  if (check.kind === "blocked") throw new ActionFlowError("blocked", check.note, check.note);
  if (check.channel !== channel) {
    throw new ActionFlowError("blocked", channel === "email" ? "This person has opted out of email. Redraft the message for LinkedIn." : "This person has opted out of LinkedIn messages. Redraft the message as an email.");
  }
}

// ---------------------------------------------------------------------------------------------
// Drafts and approval
// ---------------------------------------------------------------------------------------------

export interface DraftEdit {
  subject: string | null;
  body: string;
}

/** "Save draft": an edit is a new version by the user (BRD 12.4). Unchanged text saves nothing. */
export async function saveDraft(tx: Tx, actor: FlowActor, actionId: string, edit: DraftEdit): Promise<{ version: number; changed: boolean }> {
  can(actor, "messages.send");
  const action = await loadAction(tx, actionId);
  assertOpen(action);
  if (action.blockedReason) throw new ActionFlowError("blocked", action.blockedReason);
  const body = edit.body.replace(/\r\n/g, "\n").trim();
  if (!body) throw new ActionFlowError("empty_body", "Couldn't save: the message is empty. Write the message, or use Redraft.");
  const current = await latestDraft(tx, actionId);
  if (!current) throw new ActionFlowError("no_draft", "There is no draft yet. Use Redraft to write one.");
  const subject = current.channel === "email" ? edit.subject?.trim() || null : null;
  if (current.channel === "email" && !subject) throw new ActionFlowError("no_subject", "Couldn't save: an email needs a subject.");
  if (current.body === body && current.subject === subject) return { version: current.version, changed: false };
  const version = current.version + 1;
  await tx.insert(drafts).values({
    workspaceId: actor.workspaceId,
    actionId,
    channel: current.channel,
    subject,
    body,
    version,
    author: "user",
    contentItemId: current.contentItemId,
    rationale: current.rationale,
    checkIssues: [],
  });
  await tx.update(actions).set({ status: "drafted" }).where(eq(actions.id, actionId));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "draft.edited", entityType: "action", entityId: actionId, after: { version, from_version: current.version } });
  return { version, changed: true };
}

/** An outreach owner hands the draft to the partner (BRD 12.4). */
export async function submitForApproval(tx: Tx, actor: FlowActor, actionId: string): Promise<void> {
  can(actor, "messages.send");
  const action = await loadAction(tx, actionId);
  assertOpen(action);
  if (action.blockedReason) throw new ActionFlowError("blocked", action.blockedReason);
  const draft = await latestDraft(tx, actionId);
  if (!draft) throw new ActionFlowError("no_draft", "There is no draft to submit. Use Redraft to write one.");
  if (action.status === "awaiting_approval" || action.status === "approved") return;
  await setStatus(tx, actor, action, "awaiting_approval", "action.submitted", { version: draft.version });
}

/** The partner approves the latest version. */
export async function approveDraft(tx: Tx, actor: FlowActor, actionId: string, now = new Date()): Promise<DraftRow> {
  can(actor, "drafts.approve");
  const action = await loadAction(tx, actionId);
  assertOpen(action);
  const draft = await latestDraft(tx, actionId);
  if (!draft) throw new ActionFlowError("no_draft", "There is no draft to approve. Use Redraft to write one.");
  const issues = (draft.checkIssues as string[]) ?? [];
  if (issues.length) throw new ActionFlowError("flagged_draft", `This draft mentions facts that are not on record (${issues.join("; ")}). Edit it or redraft before approving.`);
  await assertChecksPass(tx, actor, action, draft.channel);
  if (action.status === "approved" && draft.approvedBy) return draft;
  const [approved] = await tx.update(drafts).set({ approvedBy: actor.userId, approvedAt: now }).where(eq(drafts.id, draft.id)).returning();
  await setStatus(tx, actor, action, "approved", "action.approved", { version: draft.version });
  return approved!;
}

// ---------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------

function maxPerDay(settings: unknown): number {
  return Number((settings as { send?: { max_per_day?: number } } | null)?.send?.max_per_day ?? 25);
}

/** Emails sent from this mailbox today, in the workspace's time zone (BRD 12.5 rate limit). */
export async function sentToday(tx: Tx, fromUserId: string, timeZone: string, now = new Date()): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(drafts)
    .where(and(eq(drafts.sentFromUserId, fromUserId), eq(drafts.channel, "email"), isNotNull(drafts.sentAt), gte(drafts.sentAt, startOfLocalDay(now, timeZone))));
  return row?.n ?? 0;
}

interface PreparedSend {
  action: ActionRow;
  draft: DraftRow;
  to: string;
  roleId: string | null;
  personName: string;
  from: { userId: string; email: string };
}

async function prepareSend(tx: Tx, actor: FlowActor, actionId: string, now: Date): Promise<PreparedSend> {
  can(actor, "messages.send");
  const action = await loadAction(tx, actionId);
  assertOpen(action);
  const draft = await latestDraft(tx, actionId);
  if (!draft) throw new ActionFlowError("no_draft", "There is no draft to send.");
  if (draft.channel !== "email") throw new ActionFlowError("wrong_channel", "LinkedIn messages are never sent by the platform. Copy the message, send it on LinkedIn, then mark it sent.");
  if (action.status !== "approved" || !draft.approvedBy) throw new ActionFlowError("not_approved", "This draft needs a partner's approval before it can be sent.");
  await assertChecksPass(tx, actor, action, draft.channel);

  const [ws] = await tx.select({ timezone: workspaces.timezone, settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, actor.workspaceId)).limit(1);
  const limit = maxPerDay(ws!.settings);
  if ((await sentToday(tx, draft.approvedBy, ws!.timezone, now)) >= limit) {
    throw new ActionFlowError("rate_limit", `Couldn't send: this mailbox has sent ${limit} emails today, the daily limit. It can send again tomorrow.`);
  }
  const [person] = await tx.select({ name: persons.fullName }).from(persons).where(eq(persons.id, action.personId!)).limit(1);
  const emails = await tx
    .select({ id: roles.id, email: roles.businessEmail, isPrimary: roles.isPrimary, emailStatus: roles.emailStatus })
    .from(roles)
    .where(and(eq(roles.personId, action.personId!), inArray(roles.status, ["current", "announced"]), isNotNull(roles.businessEmail)));
  const usable = emails.filter((e) => e.emailStatus !== "invalid").sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || Number(b.emailStatus === "verified") - Number(a.emailStatus === "verified"));
  if (!usable[0]) throw new ActionFlowError("no_email", `Couldn't send: there is no working email address for ${person?.name ?? "this person"}. Add one on their record.`);
  const [from] = await tx.select({ userId: users.id, email: users.email }).from(users).where(eq(users.id, draft.approvedBy)).limit(1);
  return { action, draft, to: usable[0].email!, roleId: usable[0].id, personName: person?.name ?? "", from: from! };
}

/**
 * Sends the approved email from the approving partner's mailbox and logs the outbound interaction
 * (BRD 12.5). The provider call runs outside any transaction; a failure is kept on the draft.
 */
export async function sendAction(actor: FlowActor, actionId: string, options: { sender?: MailboxSender; now?: Date } = {}): Promise<{ personName: string }> {
  const now = options.now ?? new Date();
  const prepared = await withWorkspace(actor.workspaceId, (tx) => prepareSend(tx, actor, actionId, now)).catch(async (error: unknown) => {
    await recordBlock(actor.workspaceId, actionId, error);
    throw error;
  });
  let sent;
  try {
    const sender = options.sender ?? (await getMailboxSender(actor.workspaceId, prepared.from.userId));
    sent = await sender.send({ fromUserId: prepared.from.userId, fromEmail: prepared.from.email, to: prepared.to, subject: prepared.draft.subject ?? "", body: prepared.draft.body });
  } catch (error) {
    const message = (error as Error).message.slice(0, 1000);
    await withWorkspace(actor.workspaceId, (tx) => tx.update(drafts).set({ sendError: message }).where(eq(drafts.id, prepared.draft.id)));
    if (error instanceof SendError) throw new ActionFlowError("no_mailbox", message);
    throw new ActionFlowError("send_failed", "Couldn't send: the mail provider returned an error. The draft is saved; try again in a few minutes.");
  }
  await withWorkspace(actor.workspaceId, async (tx) => {
    await tx.update(drafts).set({ sentAt: now, sentFromUserId: prepared.from.userId, providerMessageId: sent.messageId, sendError: null }).where(eq(drafts.id, prepared.draft.id));
    await tx.update(actions).set({ status: "sent" }).where(eq(actions.id, actionId));
    await tx.insert(interactions).values({
      workspaceId: actor.workspaceId,
      personId: prepared.action.personId!,
      roleId: prepared.roleId,
      channel: "email",
      direction: "outbound",
      occurredAt: now,
      ourUserId: prepared.from.userId,
      subject: prepared.draft.subject,
      threadKey: sent.threadKey,
      provider: sent.provider,
      externalId: sent.messageId,
      capturedBy: "auto",
    });
    await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "action.sent", entityType: "action", entityId: actionId, before: { status: prepared.action.status }, after: { status: "sent", channel: "email", version: prepared.draft.version, from_user_id: prepared.from.userId } });
  });
  return { personName: prepared.personName };
}

/** "Approve and send" for a partner (BRD 12.4). */
export async function approveAndSend(actor: FlowActor, actionId: string, options: { sender?: MailboxSender; now?: Date } = {}): Promise<{ personName: string }> {
  can(actor, "drafts.approve");
  await withWorkspace(actor.workspaceId, (tx) => approveDraft(tx, actor, actionId, options.now)).catch(async (error: unknown) => {
    await recordBlock(actor.workspaceId, actionId, error);
    throw error;
  });
  return sendAction(actor, actionId, options);
}

/**
 * LinkedIn drafts are copied and sent by hand; marking one sent logs a linkedin_message
 * interaction (BRD 12.5). A partner may mark an unapproved draft sent, which approves it.
 */
export async function markLinkedinSent(tx: Tx, actor: FlowActor, actionId: string, now = new Date()): Promise<{ personName: string }> {
  can(actor, "messages.send");
  const action = await loadAction(tx, actionId);
  assertOpen(action);
  let draft = await latestDraft(tx, actionId);
  if (!draft) throw new ActionFlowError("no_draft", "There is no draft to send.");
  if (draft.channel !== "linkedin_message") throw new ActionFlowError("wrong_channel", "This is an email draft. Send it with Approve and send.");
  if (action.status !== "approved" || !draft.approvedBy) {
    if (actor.role !== "partner") throw new ActionFlowError("not_approved", "This draft needs a partner's approval before it is sent.");
    draft = await approveDraft(tx, actor, actionId, now);
  } else {
    await assertChecksPass(tx, actor, action, draft.channel);
  }
  const [person] = await tx.select({ name: persons.fullName }).from(persons).where(eq(persons.id, action.personId!)).limit(1);
  await tx.update(drafts).set({ sentAt: now, sentFromUserId: actor.userId }).where(eq(drafts.id, draft.id));
  await tx.update(actions).set({ status: "sent" }).where(eq(actions.id, actionId));
  await tx.insert(interactions).values({
    workspaceId: actor.workspaceId,
    personId: action.personId!,
    channel: "linkedin_message",
    direction: "outbound",
    occurredAt: now,
    ourUserId: actor.userId,
    provider: "manual",
    externalId: `linkedin-draft-${draft.id}`,
    capturedBy: "manual",
  });
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "action.sent", entityType: "action", entityId: actionId, before: { status: action.status }, after: { status: "sent", channel: "linkedin_message", version: draft.version } });
  return { personName: person?.name ?? "" };
}

// ---------------------------------------------------------------------------------------------
// Closing, outcomes and edits
// ---------------------------------------------------------------------------------------------

export async function markDone(tx: Tx, actor: FlowActor, actionId: string): Promise<void> {
  can(actor, "messages.send");
  const action = await loadAction(tx, actionId);
  if (action.status === "done") return;
  if (![...OPEN_STATUSES, "sent"].includes(action.status as (typeof OPEN_STATUSES)[number])) throw new ActionFlowError("closed", "This action is already closed.");
  await setStatus(tx, actor, action, "done", "action.done");
}

/** Dismiss requires a reason (BRD 12.7). */
export async function dismissAction(tx: Tx, actor: FlowActor, actionId: string, reason: string): Promise<void> {
  can(actor, "actions.dismiss");
  if (!DISMISS_REASONS.includes(reason as DismissReason)) throw new ActionFlowError("no_reason", "Choose a reason for dismissing.");
  const action = await loadAction(tx, actionId);
  assertOpen(action);
  await tx.update(actions).set({ dismissReason: reason as DismissReason }).where(eq(actions.id, actionId));
  await setStatus(tx, actor, action, "dismissed", "action.dismissed", { reason });
}

export async function recordOutcome(tx: Tx, actor: FlowActor, actionId: string, outcome: string, now = new Date()): Promise<void> {
  can(actor, "messages.send");
  if (!OUTCOMES.includes(outcome as Outcome)) throw new ActionFlowError("no_outcome", "Choose an outcome.");
  const action = await loadAction(tx, actionId);
  if (action.status !== "sent" && action.status !== "done") throw new ActionFlowError("not_sent", "Outcomes are recorded once the message is sent.");
  await tx.update(actions).set({ outcome: outcome as Outcome, outcomeAt: now }).where(eq(actions.id, actionId));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "action.outcome", entityType: "action", entityId: actionId, before: { outcome: action.outcome }, after: { outcome } });
}

export interface ActionEdit {
  type?: ActionRow["type"];
  ownerUserId?: string;
  dueAt?: Date;
}

/** The suggested action, owner and due date are editable on the card (BRD 12.3). */
export async function updateAction(tx: Tx, actor: FlowActor, actionId: string, edit: ActionEdit): Promise<void> {
  can(actor, "messages.send");
  const action = await loadAction(tx, actionId);
  assertOpen(action);
  const set: Partial<ActionRow> = {};
  if (edit.type && edit.type !== action.type) set.type = edit.type;
  if (edit.ownerUserId && edit.ownerUserId !== action.ownerUserId) {
    const [member] = await tx.select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(eq(workspaceMembers.userId, edit.ownerUserId), eq(workspaceMembers.status, "active"))).limit(1);
    if (!member) throw new ActionFlowError("bad_owner", "Choose an owner who is a member of this workspace.");
    set.ownerUserId = edit.ownerUserId;
  }
  if (edit.dueAt && edit.dueAt.getTime() !== action.dueAt.getTime()) {
    set.dueAt = edit.dueAt;
    set.escalatedAt = null;
  }
  if (Object.keys(set).length === 0) return;
  await tx.update(actions).set(set).where(eq(actions.id, actionId));
  const before = Object.fromEntries(Object.keys(set).map((k) => [k, action[k as keyof ActionRow]]));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "action.updated", entityType: "action", entityId: actionId, before, after: set });
}

/**
 * Records `legitimate_interest` for email outreach with a note (BRD 12.2 step 3), clears the
 * lawful-basis block on the person's open actions, and returns the actions that now need a draft.
 */
export async function recordLawfulBasis(tx: Tx, actor: FlowActor, personId: string, note: string, now = new Date()): Promise<string[]> {
  can(actor, "consent.record_basis");
  const proof = note.trim();
  if (proof.length < 5) throw new ActionFlowError("short_note", "Say what the lawful basis is, for example the existing business relationship.");
  const [person] = await tx.select({ id: persons.id, country: persons.country }).from(persons).where(eq(persons.id, personId)).limit(1);
  if (!person) throw new ActionFlowError("not_found", "That person is not in this workspace.");
  const [before] = await tx.select({ status: consents.status }).from(consents).where(and(eq(consents.personId, personId), eq(consents.channel, "email"), eq(consents.purpose, "outreach"))).limit(1);
  if (before?.status === "opted_out") throw new ActionFlowError("opted_out", "This person has opted out of email. An opt-out cannot be overridden by a lawful basis.");
  await tx
    .insert(consents)
    .values({ workspaceId: actor.workspaceId, personId, channel: "email", purpose: "outreach", status: "legitimate_interest", jurisdiction: person.country, capturedVia: "manual", proof, recordedAt: now, recordedBy: actor.userId })
    .onConflictDoUpdate({ target: [consents.personId, consents.channel, consents.purpose], set: { status: "legitimate_interest", proof, recordedAt: now, recordedBy: actor.userId, jurisdiction: person.country, capturedVia: "manual" } });
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "consent.recorded", entityType: "person", entityId: personId, before: { status: before?.status ?? "unknown" }, after: { channel: "email", purpose: "outreach", status: "legitimate_interest" } });
  const unblocked = await tx
    .update(actions)
    .set({ blockedReason: null })
    .where(and(eq(actions.personId, personId), eq(actions.blockedReason, BLOCK_NOTES.lawful_basis), inArray(actions.status, [...OPEN_STATUSES])))
    .returning({ id: actions.id });
  const needDraft: string[] = [];
  for (const a of unblocked) {
    const [has] = await tx.select({ n: sql<number>`count(*)::int` }).from(drafts).where(eq(drafts.actionId, a.id));
    if (!has?.n) needDraft.push(a.id);
  }
  return needDraft;
}
