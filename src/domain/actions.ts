/**
 * Actions created from confirmed signals (BRD 12.1, 12.3, 12.8) and their AI drafts (12.4, 17.3).
 * M4 builds creation, the due date and the first draft; M5 adds the remaining pre-action checks,
 * merging, approval and sending.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { SignalType } from "@/ai/contracts";
import { getAi, type AiAdapter } from "@/ai/adapter";
import { AiBudgetPausedError, assertAiAllowed, recordAiCall } from "@/ai/budget";
import { withWorkspace, type Tx } from "@/db/client";
import { actions, companies, contentItems, drafts, interactions, personInterests, persons, roles, signals, signalSources, users, workspaceMembers, workspaces } from "@/db/schema";
import { audit } from "@/lib/audit";
import { addWorkingDays } from "@/lib/working-days";
import { SIGNAL_RULES } from "@/pipeline/rules";
import { isSuppressed } from "./suppression";
import { SENIORITY_RANK } from "./titles";

interface Settings {
  sla?: { p1_working_days?: number; p2_working_days?: number; announced_lead_working_days?: number };
  working_days?: string[];
  style_guide?: string;
}

type SignalRow = typeof signals.$inferSelect;

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
}

/**
 * Creates the action for a confirmed priority 1 or 2 signal. Returns null when no action applies:
 * priority 3, a type with no default action, or a person who must not be contacted (BRD 12.2 step 1).
 */
export async function createActionForSignal(tx: Tx, signal: SignalRow, confirmedAt: Date, options: { force?: boolean } = {}): Promise<CreatedAction | null> {
  const rule = SIGNAL_RULES[signal.type as SignalType];
  if (!options.force && (signal.priority > 2 || !rule.action)) return null;
  const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, signal.workspaceId)).limit(1);
  const settings = (ws!.settings ?? {}) as Settings;

  let personId = signal.personId;
  let type = rule.action ?? "custom";
  let headline: string | null = null;
  if (!personId && signal.companyId) personId = await targetForCompany(tx, signal.companyId);
  if (!personId) {
    const [company] = signal.companyId ? await tx.select({ name: companies.name }).from(companies).where(eq(companies.id, signal.companyId)).limit(1) : [];
    type = "custom";
    headline = `Find the right contact at ${company?.name ?? "this company"}`;
  }

  if (personId) {
    const [person] = await tx.select().from(persons).where(eq(persons.id, personId)).limit(1);
    if (!person || !person.isTracked || person.status === "do_not_contact") return null;
    const emails = (await tx.select({ e: roles.businessEmail }).from(roles).where(eq(roles.personId, personId))).map((r) => r.e);
    if (await isSuppressed(tx, signal.workspaceId, { emails, linkedinUrls: [person.linkedinUrl] })) return null;
  }

  const [owner] = personId ? await tx.select({ id: persons.relationshipOwnerId }).from(persons).where(eq(persons.id, personId)).limit(1) : [];
  const ownerUserId = owner?.id ?? (await partnerOf(tx));
  if (!ownerUserId) return null;

  const [row] = await tx
    .insert(actions)
    .values({
      workspaceId: signal.workspaceId,
      signalId: signal.id,
      personId,
      companyId: signal.companyId,
      type,
      status: "open",
      headline,
      ownerUserId,
      dueAt: dueDate(signal, confirmedAt, settings, ws!.timezone),
      whyItMatters: rule.why,
    })
    .returning({ id: actions.id });
  await audit(tx, { workspaceId: signal.workspaceId, actorUserId: null, actorKind: "system", action: "action.created", entityType: "action", entityId: row!.id, after: { signal_id: signal.id, type } });
  return { actionId: row!.id, needsDraft: !!personId };
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

/** Writes the first (or next) AI draft for an action. Runs the AI call outside any transaction. */
export async function draftForAction(workspaceId: string, actionId: string, options: { ai?: AiAdapter; now?: () => Date; instruction?: string } = {}): Promise<string | null> {
  const now = options.now ?? (() => new Date());
  const prepared = await withWorkspace(workspaceId, async (tx) => {
    const [action] = await tx.select().from(actions).where(eq(actions.id, actionId)).limit(1);
    if (!action?.personId) return null;
    const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const settings = ws!.settings as Record<string, unknown> & Settings;
    const [signal] = action.signalId ? await tx.select().from(signals).where(eq(signals.id, action.signalId)).limit(1) : [];
    try {
      await assertAiAllowed(tx, settings, signal && signal.priority === 1 ? "draft_p1" : "draft_p2", now());
    } catch (error) {
      if (error instanceof AiBudgetPausedError) return null;
      throw error;
    }
    const [person] = await tx.select().from(persons).where(eq(persons.id, action.personId)).limit(1);
    const [role] = await tx.select({ title: roles.title, company: companies.name, email: roles.businessEmail, emailStatus: roles.emailStatus }).from(roles).innerJoin(companies, eq(companies.id, roles.companyId)).where(and(eq(roles.personId, person!.id), eq(roles.isPrimary, true))).limit(1);
    const [owner] = await tx.select({ name: users.name }).from(users).where(eq(users.id, action.ownerUserId)).limit(1);
    const [source] = signal ? await tx.select({ title: signalSources.title }).from(signalSources).where(eq(signalSources.signalId, signal.id)).limit(1) : [];
    const recent = await tx.select({ channel: interactions.channel, occurredAt: interactions.occurredAt, direction: interactions.direction, subject: interactions.subject, isPrivate: interactions.isPrivate }).from(interactions).where(eq(interactions.personId, person!.id)).orderBy(desc(interactions.occurredAt)).limit(3);
    const interests = (await tx.select({ topic: personInterests.topic }).from(personInterests).where(eq(personInterests.personId, person!.id))).map((i) => i.topic);
    const [content] = interests.length
      ? await tx.select().from(contentItems).where(sql`${contentItems.topics} && array[${sql.join(interests.map((i) => sql`${i}`), sql`, `)}]::text[]`).orderBy(desc(contentItems.publishedOn)).limit(1)
      : [];
    const previous = await tx.select({ version: drafts.version }).from(drafts).where(eq(drafts.actionId, actionId)).orderBy(desc(drafts.version)).limit(1);
    const names = {
      companies: (await tx.select({ n: companies.name }).from(companies)).map((c) => c.n),
      people: (await tx.select({ n: persons.fullName }).from(persons)).map((p) => p.n),
    };
    const input = {
      partnerName: owner?.name ?? "The partner",
      styleGuide: settings.style_guide ?? "",
      person: { preferredName: person!.preferredName ?? person!.fullName.split(" ")[0]!, fullName: person!.fullName, role: role?.title ?? null, company: role?.company ?? null, contactTypes: person!.contactTypes, country: person!.country },
      signal: signal ? { headline: signal.headline, type: signal.type, eventOn: signal.eventOn, effectiveOn: signal.effectiveOn, sourceTitle: source?.title ?? null } : null,
      suggestedAction: action.type,
      bestPath: null,
      recentInteractions: recent.map((r) => ({ channel: r.channel, date: r.occurredAt.toISOString().slice(0, 10), direction: r.direction, subject: r.isPrivate ? null : r.subject })),
      band: null,
      contentItem: content ? { title: content.title, description: content.description, url: content.url } : null,
      channel: (role?.email && role.emailStatus === "verified" ? "email" : "linkedin_message") as "email" | "linkedin_message",
      instruction: options.instruction ?? null,
    };
    return { input, settings, contentId: content?.id ?? null, version: (previous[0]?.version ?? 0) + 1, names };
  });
  if (!prepared) return null;

  const ai = options.ai ?? (await getAi(undefined, now));
  let result;
  try {
    result = await ai.draftMessage(prepared.input);
  } catch (error) {
    const call = (error as { call?: Parameters<typeof recordAiCall>[2] }).call;
    if (call) await withWorkspace(workspaceId, (tx) => recordAiCall(tx, workspaceId, call, prepared.settings, now()));
    return null;
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
        subject: result.output.subject,
        body: result.output.body,
        version: prepared.version,
        author: "ai",
        model: result.call.model,
        promptVersion: result.call.promptVersion,
        contentItemId: result.output.used_content_item ? prepared.contentId : null,
        checkIssues: issues,
      })
      .returning({ id: drafts.id });
    await tx.update(actions).set({ status: "drafted" }).where(and(eq(actions.id, actionId), inArray(actions.status, ["open", "drafted"])));
    return draft!.id;
  });
}
