/**
 * Actions from confirmed signals and from people pages (BRD 12.1 to 12.3, 12.8) and their AI
 * drafts (12.4, 17.3). Approval, sending and outcomes are in action-flow.ts.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { DraftInput, SignalType } from "@/ai/contracts";
import { getAi, type AiAdapter } from "@/ai/adapter";
import { AiBudgetPausedError, assertAiAllowed, recordAiCall } from "@/ai/budget";
import { withWorkspace, type Tx } from "@/db/client";
import { actions, companies, contentItems, drafts, interactions, personInterests, persons, roles, signals, signalSources, users, workspaceMembers, workspaces } from "@/db/schema";
import { audit } from "@/lib/audit";
import { addWorkingDays, localDate } from "@/lib/working-days";
import { appLink, EMAIL_FOOTER, queueNotification } from "@/mail/notify";
import { SIGNAL_RULES } from "@/pipeline/rules";
import { evaluateChecks, loadCheckFacts, type Channel, type Purpose } from "./checks";
import { bandFor, isWarmOrStrong } from "./relationships";
import { SENIORITY_RANK } from "./titles";

interface Settings {
  sla?: { p1_working_days?: number; p2_working_days?: number; announced_lead_working_days?: number };
  working_days?: string[];
  style_guide?: string;
}

type SignalRow = typeof signals.$inferSelect;
export type ActionType = (typeof actions.$inferInsert)["type"];

/** Due date (BRD 12.8): P1 two working days, P2 five, an announced move two working days before it starts. */
export function dueDate(signal: Pick<SignalRow, "priority" | "type" | "effectiveOn">, confirmedAt: Date, settings: Settings, timeZone: string): Date {
  const days = settings.working_days ?? ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const p1 = addWorkingDays(confirmedAt, settings.sla?.p1_working_days ?? 2, timeZone, days);
  if (signal.type === "person_move_announced" && signal.effectiveOn) {
    const beforeStart = addWorkingDays(new Date(`${signal.effectiveOn}T12:00:00Z`), -(settings.sla?.announced_lead_working_days ?? 2), timeZone, days);
    // When the start is too close for that lead time, fall back to the priority 1 default.
    return beforeStart > p1 ? beforeStart : p1;
  }
  return signal.priority === 1 ? p1 : addWorkingDays(confirmedAt, settings.sla?.p2_working_days ?? 5, timeZone, days);
}

async function partnerOf(tx: Tx): Promise<string | null> {
  const [m] = await tx.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.role, "partner"), eq(workspaceMembers.status, "active"))).limit(1);
  return m?.userId ?? null;
}

/** Whom a company signal is for (BRD 12.1): the person named, else the most senior tracked person there. */
async function targetForCompany(tx: Tx, companyId: string): Promise<string | null> {
  const people = await tx
    .select({ personId: roles.personId, seniority: roles.seniority, title: roles.titleNormalised, status: persons.status })
    .from(roles)
    .innerJoin(persons, eq(persons.id, roles.personId))
    .where(and(eq(roles.companyId, companyId), eq(roles.status, "current"), eq(persons.isTracked, true), sql`${persons.mergedIntoId} is null`, sql`${persons.status} <> 'do_not_contact'`));
  const order = (t: string | null) => (t === "CEO" ? 0 : t === "Chair" ? 1 : 2);
  people.sort((a, b) => order(a.title) - order(b.title) || SENIORITY_RANK[b.seniority] - SENIORITY_RANK[a.seniority]);
  return people[0]?.personId ?? null;
}

export interface CreatedAction {
  actionId: string;
  needsDraft: boolean;
  /** The signal was added to an open action from the last 7 days (BRD 12.2 step 5). */
  merged?: boolean;
}

export const OPEN_STATUSES = ["open", "drafted", "awaiting_approval", "approved"] as const;
const MERGE_WINDOW_MS = 7 * 86_400_000;

export const purposeForType = (type: string): Purpose => (type === "invite_interview" ? "candidate" : "client");

/** An open action for the person created in the last 7 days, which a new signal joins. */
async function recentOpenAction(tx: Tx, personId: string, now: Date): Promise<{ id: string; mergedSignalIds: string[] } | null> {
  const [row] = await tx
    .select({ id: actions.id, mergedSignalIds: actions.mergedSignalIds })
    .from(actions)
    .where(and(eq(actions.personId, personId), inArray(actions.status, [...OPEN_STATUSES]), gte(actions.createdAt, new Date(now.getTime() - MERGE_WINDOW_MS))))
    .orderBy(desc(actions.createdAt))
    .limit(1);
  return row ?? null;
}

/** Priority 1 change on a strong or warm relationship: email the owner within 15 minutes (BRD 12.8). */
async function alertP1Change(tx: Tx, signal: SignalRow, personId: string, ownerUserId: string, actionId: string): Promise<void> {
  if (signal.priority !== 1) return;
  const band = await bandFor(tx, personId, ownerUserId);
  if (!isWarmOrStrong(band?.band)) return;
  const [owner] = await tx.select({ email: users.email }).from(users).where(eq(users.id, ownerUserId)).limit(1);
  const [person] = await tx.select({ name: persons.fullName }).from(persons).where(eq(persons.id, personId)).limit(1);
  if (!owner || !person) return;
  await queueNotification(tx, {
    workspaceId: signal.workspaceId,
    userId: ownerUserId,
    toEmail: owner.email,
    kind: "p1_change",
    dedupeKey: `p1_change:${signal.id}:${ownerUserId}`,
    subject: `Priority 1 change: ${signal.headline}`.slice(0, 200),
    bodyText: `${signal.headline}\n\nYou have a ${band!.band} relationship with ${person.name}. An action is waiting for you.\n\nOpen the action: ${appLink(`/actions?id=${actionId}`)}${EMAIL_FOOTER}`,
  });
}

/**
 * Creates the action for a confirmed priority 1 or 2 signal (BRD 12.1) after the pre-action
 * checks (12.2). Returns null when no action applies: priority 3, a type with no default action,
 * an untracked person, or a person who must not be contacted.
 */
export async function createActionForSignal(tx: Tx, signal: SignalRow, confirmedAt: Date, options: { force?: boolean } = {}): Promise<CreatedAction | null> {
  const rule = SIGNAL_RULES[signal.type as SignalType];
  if (!options.force && (signal.priority > 2 || !rule.action)) return null;
  const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, signal.workspaceId)).limit(1);
  const settings = (ws!.settings ?? {}) as Settings;

  let personId = signal.personId;
  let type: ActionType = rule.action ?? "custom";
  let headline: string | null = null;
  if (!personId && signal.companyId) personId = await targetForCompany(tx, signal.companyId);
  if (!personId) {
    const [company] = signal.companyId ? await tx.select({ name: companies.name }).from(companies).where(eq(companies.id, signal.companyId)).limit(1) : [];
    type = "custom";
    headline = `Find the right contact at ${company?.name ?? "this company"}`;
  }

  const purpose = purposeForType(type);
  let blocked: { reason: string; note: string } | null = null;
  if (personId) {
    const [person] = await tx.select({ isTracked: persons.isTracked }).from(persons).where(eq(persons.id, personId)).limit(1);
    if (!person?.isTracked) return null;
    const facts = await loadCheckFacts(tx, signal.workspaceId, personId);
    if (!facts) return null;
    const check = evaluateChecks(facts, purpose, localDate(confirmedAt, ws!.timezone));
    if (check.kind === "no_action") return null;
    if (check.kind === "blocked") blocked = { reason: check.reason, note: check.note };

    const existing = await recentOpenAction(tx, personId, confirmedAt);
    if (existing) {
      if (!existing.mergedSignalIds.includes(signal.id)) {
        await tx.update(actions).set({ mergedSignalIds: [...existing.mergedSignalIds, signal.id] }).where(eq(actions.id, existing.id));
        await audit(tx, { workspaceId: signal.workspaceId, actorUserId: null, actorKind: "system", action: "action.signal_merged", entityType: "action", entityId: existing.id, after: { signal_id: signal.id } });
      }
      return { actionId: existing.id, needsDraft: false, merged: true };
    }
  }

  const [owner] = personId ? await tx.select({ id: persons.relationshipOwnerId }).from(persons).where(eq(persons.id, personId)).limit(1) : [];
  const ownerUserId = owner?.id ?? (await partnerOf(tx));
  if (!ownerUserId) return null;

  // Off-limits dismisses the action with that reason; a missing lawful basis or opt-outs keep it
  // open with the draft blocked (BRD 12.2 steps 3 and 4).
  const offLimits = blocked?.reason === "off_limits";
  const [row] = await tx
    .insert(actions)
    .values({
      workspaceId: signal.workspaceId,
      signalId: signal.id,
      personId,
      companyId: signal.companyId,
      type,
      purpose,
      status: offLimits ? "dismissed" : "open",
      dismissReason: offLimits ? "off_limits" : null,
      blockedReason: blocked?.note ?? null,
      headline,
      ownerUserId,
      dueAt: dueDate(signal, confirmedAt, settings, ws!.timezone),
      whyItMatters: rule.why,
    })
    .returning({ id: actions.id });
  await audit(tx, { workspaceId: signal.workspaceId, actorUserId: null, actorKind: "system", action: "action.created", entityType: "action", entityId: row!.id, after: { signal_id: signal.id, type, ...(blocked ? { blocked: blocked.reason } : {}) } });
  if (personId && !offLimits) await alertP1Change(tx, signal, personId, ownerUserId, row!.id);
  return { actionId: row!.id, needsDraft: !!personId && !blocked };
}

export interface ManualActionInput {
  personId: string;
  type: ActionType;
  purpose: Purpose;
  ownerUserId: string;
  dueAt: Date;
  headline?: string | null;
}

/** "Create action" on a person page (BRD 12.1). Checks 1 to 4 apply; an explicit request is never merged. */
export async function createManualAction(tx: Tx, actor: { workspaceId: string; userId: string }, input: ManualActionInput): Promise<CreatedAction | { refused: string }> {
  const [ws] = await tx.select({ timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, actor.workspaceId)).limit(1);
  const facts = await loadCheckFacts(tx, actor.workspaceId, input.personId);
  if (!facts) return { refused: "That person is not in this workspace." };
  const check = evaluateChecks(facts, input.purpose, localDate(new Date(), ws!.timezone));
  if (check.kind === "no_action") return { refused: "This person must not be contacted, so no action can be created." };
  if (check.kind === "blocked" && check.reason === "off_limits") return { refused: check.note };
  const [row] = await tx
    .insert(actions)
    .values({
      workspaceId: actor.workspaceId,
      personId: input.personId,
      type: input.type,
      purpose: input.purpose,
      status: "open",
      headline: input.headline ?? null,
      ownerUserId: input.ownerUserId,
      dueAt: input.dueAt,
      blockedReason: check.kind === "blocked" ? check.note : null,
      whyItMatters: null,
    })
    .returning({ id: actions.id });
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "action.created", entityType: "action", entityId: row!.id, after: { type: input.type, purpose: input.purpose, manual: true } });
  return { actionId: row!.id, needsDraft: check.kind === "ok" };
}

// ---------------------------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------------------------

/**
 * Facts in the draft that are not in the context (BRD 17.2): years, numbers, company names and
 * person names. A non-empty list flags the draft for regeneration; it is never silently edited.
 */
export function postCheck(body: string, context: string, knownNames: { companies: string[]; people: string[] }): string[] {
  const issues: string[] = [];
  const ctx = context.toLowerCase();
  for (const n of new Set(body.match(/\b\d[\d,.]*\b/g) ?? [])) if (!ctx.includes(n.toLowerCase())) issues.push(`Number not in context: ${n}`);
  for (const c of knownNames.companies) if (body.includes(c) && !context.includes(c)) issues.push(`Company not in context: ${c}`);
  for (const p of knownNames.people) if (body.includes(p) && !context.includes(p)) issues.push(`Person not in context: ${p}`);
  return issues;
}

export type DraftOutcome =
  | { kind: "drafted"; draftId: string }
  | { kind: "blocked"; reason: "lawful_basis" | "off_limits" | "opted_out" | "no_action"; note: string }
  | { kind: "skipped"; note: string };

export interface DraftOptions {
  ai?: AiAdapter;
  now?: () => Date;
  /** Optional redraft instruction, for example "shorter" (BRD 12.4). */
  instruction?: string;
  /** A redraft may ask for a candidate or client approach; checks run against it (BRD 12.2 step 4). */
  purpose?: Purpose;
  channel?: Channel;
}

const DRAFTABLE = ["open", "drafted", "awaiting_approval", "approved"];

/**
 * Writes the first (or next) AI draft for an action, after the pre-action checks. The AI call
 * runs outside any transaction. A blocked check records its note on the action and drafts nothing.
 */
export async function draftForAction(workspaceId: string, actionId: string, options: DraftOptions = {}): Promise<DraftOutcome> {
  const now = options.now ?? (() => new Date());
  const prepared = await withWorkspace(workspaceId, async (tx): Promise<DraftOutcome | { input: DraftInput; settings: Record<string, unknown>; contentId: string | null; version: number; names: { companies: string[]; people: string[] }; purpose: Purpose }> => {
    const [action] = await tx.select().from(actions).where(eq(actions.id, actionId)).limit(1);
    if (!action?.personId) return { kind: "skipped", note: "This action has no person to write to yet." };
    if (!DRAFTABLE.includes(action.status)) return { kind: "skipped", note: "This action is closed, so it cannot be redrafted." };
    const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const settings = ws!.settings as Record<string, unknown> & Settings;
    const purpose = options.purpose ?? action.purpose;

    const facts = await loadCheckFacts(tx, workspaceId, action.personId);
    const previous = await tx.select({ version: drafts.version, channel: drafts.channel }).from(drafts).where(eq(drafts.actionId, actionId)).orderBy(desc(drafts.version)).limit(1);
    const check = facts ? evaluateChecks(facts, purpose, localDate(now(), ws!.timezone), options.channel ?? previous[0]?.channel) : ({ kind: "no_action", reason: "do_not_contact" } as const);
    if (check.kind === "no_action") return { kind: "blocked", reason: "no_action", note: "This person must not be contacted." };
    if (check.kind === "blocked") {
      // A candidate redraft refused for off-limits leaves the action's client approach intact.
      if (!(check.reason === "off_limits" && options.purpose && options.purpose !== action.purpose)) {
        await tx.update(actions).set({ blockedReason: check.note }).where(eq(actions.id, actionId));
      }
      await audit(tx, { workspaceId, actorUserId: null, actorKind: "system", action: "draft.blocked", entityType: "action", entityId: actionId, after: { reason: check.reason, purpose } });
      return { kind: "blocked", reason: check.reason, note: check.note };
    }
    if (action.blockedReason || purpose !== action.purpose) await tx.update(actions).set({ blockedReason: null, purpose }).where(eq(actions.id, actionId));

    const [signal] = action.signalId ? await tx.select().from(signals).where(eq(signals.id, action.signalId)).limit(1) : [];
    try {
      await assertAiAllowed(tx, settings, signal && signal.priority === 1 ? "draft_p1" : "draft_p2", now());
    } catch (error) {
      if (error instanceof AiBudgetPausedError) return { kind: "skipped", note: error.message };
      throw error;
    }
    const [person] = await tx.select().from(persons).where(eq(persons.id, action.personId)).limit(1);
    const [role] = await tx.select({ title: roles.title, company: companies.name }).from(roles).innerJoin(companies, eq(companies.id, roles.companyId)).where(and(eq(roles.personId, person!.id), eq(roles.isPrimary, true))).limit(1);
    const [owner] = await tx.select({ name: users.name }).from(users).where(eq(users.id, action.ownerUserId)).limit(1);
    const [source] = signal ? await tx.select({ title: signalSources.title }).from(signalSources).where(eq(signalSources.signalId, signal.id)).limit(1) : [];
    const recent = await tx.select({ channel: interactions.channel, occurredAt: interactions.occurredAt, direction: interactions.direction, subject: interactions.subject, isPrivate: interactions.isPrivate }).from(interactions).where(eq(interactions.personId, person!.id)).orderBy(desc(interactions.occurredAt)).limit(3);
    const interests = (await tx.select({ topic: personInterests.topic }).from(personInterests).where(eq(personInterests.personId, person!.id))).map((i) => i.topic);
    const [content] = interests.length
      ? await tx.select().from(contentItems).where(sql`${contentItems.topics} && array[${sql.join(interests.map((i) => sql`${i}`), sql`, `)}]::text[]`).orderBy(desc(contentItems.publishedOn)).limit(1)
      : [];
    const band = await bandFor(tx, person!.id, action.ownerUserId);
    const names = {
      companies: (await tx.select({ n: companies.name }).from(companies)).map((c) => c.n),
      people: (await tx.select({ n: persons.fullName }).from(persons)).map((p) => p.n),
    };
    const input: DraftInput = {
      partnerName: owner?.name ?? "The partner",
      styleGuide: settings.style_guide ?? "",
      person: { preferredName: person!.preferredName ?? person!.fullName.split(" ")[0]!, fullName: person!.fullName, role: role?.title ?? null, company: role?.company ?? null, contactTypes: person!.contactTypes, country: person!.country },
      signal: signal ? { headline: signal.headline, type: signal.type, eventOn: signal.eventOn, effectiveOn: signal.effectiveOn, sourceTitle: source?.title ?? null } : null,
      suggestedAction: action.type,
      bestPath: null,
      recentInteractions: recent.map((r) => ({ channel: r.channel, date: r.occurredAt.toISOString().slice(0, 10), direction: r.direction, subject: r.isPrivate ? null : r.subject })),
      band: band?.band ?? null,
      contentItem: content ? { title: content.title, description: content.description, url: content.url } : null,
      channel: check.channel,
      instruction: options.instruction?.trim().slice(0, 300) || null,
    };
    return { input, settings, contentId: content?.id ?? null, version: (previous[0]?.version ?? 0) + 1, names, purpose };
  });
  if ("kind" in prepared) return prepared;

  const ai = options.ai ?? (await getAi(undefined, now));
  let result;
  try {
    result = await ai.draftMessage(prepared.input);
  } catch (error) {
    const call = (error as { call?: Parameters<typeof recordAiCall>[2] }).call;
    if (call) await withWorkspace(workspaceId, (tx) => recordAiCall(tx, workspaceId, call, prepared.settings, now()));
    return { kind: "skipped", note: "The AI could not write a draft. Try Redraft, or write the message yourself." };
  }
  const issues = postCheck(result.output.body.replace(/^\[Mock draft\]\s*/, ""), JSON.stringify(prepared.input), prepared.names);

  return withWorkspace(workspaceId, async (tx) => {
    await recordAiCall(tx, workspaceId, result.call, prepared.settings, now());
    const [draft] = await tx
      .insert(drafts)
      .values({
        workspaceId,
        actionId,
        channel: prepared.input.channel,
        subject: prepared.input.channel === "email" ? result.output.subject : null,
        body: result.output.body,
        version: prepared.version,
        author: "ai",
        model: result.call.model,
        promptVersion: result.call.promptVersion,
        contentItemId: result.output.used_content_item ? prepared.contentId : null,
        rationale: result.output.rationale,
        checkIssues: issues,
      })
      .returning({ id: drafts.id });
    // A new version needs approving again (BRD 12.4).
    await tx.update(actions).set({ status: "drafted" }).where(and(eq(actions.id, actionId), inArray(actions.status, ["open", "drafted", "awaiting_approval", "approved"])));
    await audit(tx, { workspaceId, actorUserId: null, actorKind: "system", action: "draft.generated", entityType: "action", entityId: actionId, after: { version: prepared.version, channel: prepared.input.channel, ...(prepared.input.instruction ? { instruction: prepared.input.instruction } : {}) } });
    return { kind: "drafted" as const, draftId: draft!.id };
  });
}
