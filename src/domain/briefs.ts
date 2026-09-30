/**
 * Meeting briefs (BRD 12.6, 17.3). The hourly `briefs.generate` job briefs every calendar event
 * 20 to 26 hours ahead that has a tracked attendee, attaches the brief to the event, and emails it
 * to the event owner; the digest links it. Briefs are also made on demand from a person page.
 *
 * What the AI sees: roles, recent signals, interaction metadata (private subjects removed), the
 * relationship score, paths, interests, content already sent and open actions. Never mandate notes.
 */
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getAi, type AiAdapter } from "@/ai/adapter";
import { AiBudgetPausedError, assertAiAllowed, recordAiCall } from "@/ai/budget";
import { briefMarkdown, type BriefInput } from "@/ai/contracts";
import { withWorkspace, type Tx } from "@/db/client";
import { actions, briefs, calendarEvents, companies, contentItems, drafts, interactions, personInterests, persons, relationshipScores, roles, signals, users, workspaces } from "@/db/schema";
import { audit } from "@/lib/audit";
import { formatDateIn, formatTimeIn } from "@/lib/format/labels";
import { appLink, EMAIL_FOOTER, queueNotification } from "@/mail/notify";
import { OPEN_STATUSES } from "./actions";
import { findPaths } from "./paths";
import type { Factors } from "./scoring";

const DAY = 86_400_000;
const HOUR = 3_600_000;
export const BRIEF_WINDOW = { fromHours: 20, toHours: 26 } as const;

export async function buildBriefInput(tx: Tx, personId: string, now: Date, meeting: BriefInput["meeting"] = null): Promise<BriefInput | null> {
  const [person] = await tx.select().from(persons).where(eq(persons.id, personId)).limit(1);
  if (!person) return null;
  const roleRows = await tx
    .select({ title: roles.title, company: companies.name, companyId: roles.companyId, from: roles.effectiveOn, to: roles.endedOn, status: roles.status, isPrimary: roles.isPrimary })
    .from(roles)
    .innerJoin(companies, eq(companies.id, roles.companyId))
    .where(eq(roles.personId, personId))
    .orderBy(desc(roles.isPrimary), sql`${roles.effectiveOn} desc nulls last`);
  const primary = roleRows.find((r) => r.isPrimary) ?? roleRows[0];
  const companyIds = roleRows.filter((r) => r.status === "current").map((r) => r.companyId);
  const since = new Date(now.getTime() - 90 * DAY);
  const signalRows = await tx
    .select({ headline: signals.headline, date: signals.eventOn, personId: signals.personId, confirmedAt: signals.confirmedAt })
    .from(signals)
    .where(and(eq(signals.status, "confirmed"), gte(signals.confirmedAt, since), or(eq(signals.personId, personId), companyIds.length ? and(inArray(signals.companyId, companyIds), isNull(signals.personId)) : sql`false`)))
    .orderBy(desc(signals.confirmedAt))
    .limit(8);
  const interactionRows = await tx
    .select({ channel: interactions.channel, occurredAt: interactions.occurredAt, direction: interactions.direction, subject: interactions.subject, isPrivate: interactions.isPrivate })
    .from(interactions)
    .where(and(eq(interactions.personId, personId), sql`${interactions.channel} <> 'newsletter_open'`))
    .orderBy(desc(interactions.occurredAt))
    .limit(12);
  const [score] = await tx.select().from(relationshipScores).where(and(eq(relationshipScores.personId, personId), isNull(relationshipScores.userId))).limit(1);
  const factors = score?.factors as Factors | undefined;
  const interests = await tx.select({ topic: personInterests.topic, source: personInterests.source }).from(personInterests).where(eq(personInterests.personId, personId));
  const sent = await tx
    .select({ title: contentItems.title, sentAt: drafts.sentAt })
    .from(drafts)
    .innerJoin(actions, eq(actions.id, drafts.actionId))
    .innerJoin(contentItems, eq(contentItems.id, drafts.contentItemId))
    .where(and(eq(actions.personId, personId), sql`${drafts.sentAt} is not null`));
  const open = await tx.select({ type: actions.type, headline: actions.headline, dueAt: actions.dueAt }).from(actions).where(and(eq(actions.personId, personId), inArray(actions.status, [...OPEN_STATUSES])));
  const day = (d: Date) => d.toISOString().slice(0, 10);

  return {
    person: { fullName: person.fullName, role: primary?.title ?? null, company: primary?.company ?? null, country: person.country },
    roles: roleRows.slice(0, 6).map((r) => ({ title: r.title, company: r.company, from: r.from, to: r.to, status: r.status })),
    signals: signalRows.map((s) => ({ headline: s.headline, date: s.date ?? (s.confirmedAt ? day(s.confirmedAt) : null), about: s.personId ? "person" : "company" })),
    interactions: interactionRows.map((i) => ({ channel: i.channel, date: day(i.occurredAt), direction: i.direction, subject: i.isPrivate ? null : i.subject })),
    relationship: score && factors
      ? { band: score.band, score: score.score, factors: [`last two-way touch ${factors.recency.raw.daysSinceLastTwoWay ?? "never"} days ago`, `${factors.frequency.raw.twoWayTouches12m} two-way touches in 12 months`, `${factors.depth.raw.meetings} meetings in 12 months`] }
      : null,
    paths: (await findPaths(tx, personId, day(now))).filter((p) => p.kind === "one_hop").map((p) => ({ explanation: p.explanation })),
    interests: interests.map((i) => ({ topic: i.topic, source: i.source })),
    contentSent: sent.map((c) => ({ title: c.title, date: day(c.sentAt!) })),
    openActions: open.map((a) => ({ type: a.type, headline: a.headline, due: day(a.dueAt) })),
    meeting,
  };
}

export type BriefOutcome = { kind: "made"; briefId: string } | { kind: "skipped"; reason: string };

/** Writes a brief for a person, optionally attached to a calendar event. The AI call runs outside any transaction. */
export async function generateBrief(workspaceId: string, personId: string, options: { calendarEventId?: string; automatic?: boolean; ai?: AiAdapter; now?: Date; actorUserId?: string | null } = {}): Promise<BriefOutcome> {
  const now = options.now ?? new Date();
  const prepared = await withWorkspace(workspaceId, async (tx) => {
    const [ws] = await tx.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const settings = ws!.settings as Record<string, unknown>;
    if (options.automatic) {
      try {
        await assertAiAllowed(tx, settings, "brief", now);
      } catch (error) {
        if (error instanceof AiBudgetPausedError) return { skipped: error.message };
        throw error;
      }
    }
    const [event] = options.calendarEventId ? await tx.select().from(calendarEvents).where(eq(calendarEvents.id, options.calendarEventId)).limit(1) : [];
    const input = await buildBriefInput(tx, personId, now, event ? { title: event.title, startsAt: event.startsAt.toISOString() } : null);
    return input ? { input, settings } : { skipped: "That person is not in this workspace." };
  });
  if ("skipped" in prepared) return { kind: "skipped", reason: prepared.skipped as string };

  const ai = options.ai ?? (await getAi(undefined, () => now));
  let result;
  try {
    result = await ai.meetingBrief(prepared.input);
  } catch (error) {
    const call = (error as { call?: Parameters<typeof recordAiCall>[2] }).call;
    if (call) await withWorkspace(workspaceId, (tx) => recordAiCall(tx, workspaceId, call, prepared.settings, now));
    return { kind: "skipped", reason: "The AI could not write the brief. Try again later." };
  }
  const markdown = briefMarkdown(result.output);
  const briefId = await withWorkspace(workspaceId, async (tx) => {
    await recordAiCall(tx, workspaceId, result.call, prepared.settings, now);
    const [row] = await tx
      .insert(briefs)
      .values({ workspaceId, personId, calendarEventId: options.calendarEventId ?? null, contentMarkdown: markdown, model: result.call.model, promptVersion: result.call.promptVersion, generatedAt: now })
      .returning({ id: briefs.id });
    if (options.calendarEventId) await tx.update(calendarEvents).set({ briefId: row!.id }).where(eq(calendarEvents.id, options.calendarEventId));
    await audit(tx, { workspaceId, actorUserId: options.actorUserId ?? null, actorKind: options.actorUserId ? "user" : "system", action: "brief.generated", entityType: "person", entityId: personId, after: { brief_id: row!.id, calendar_event_id: options.calendarEventId ?? null } });
    return row!.id;
  });
  return { kind: "made", briefId };
}

/** The hourly job: brief meetings 20 to 26 hours ahead, then email each brief to the event owner. */
export async function runBriefs(workspaceId: string, options: { now?: Date; ai?: AiAdapter } = {}): Promise<{ events: number; made: number }> {
  const now = options.now ?? new Date();
  const due = await withWorkspace(workspaceId, async (tx) => {
    const [ws] = await tx.select({ flags: workspaces.flags }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if ((ws!.flags as Record<string, boolean>)["rel.briefs"] === false) return [];
    return tx
      .select()
      .from(calendarEvents)
      .where(and(isNull(calendarEvents.briefId), gte(calendarEvents.startsAt, new Date(now.getTime() + BRIEF_WINDOW.fromHours * HOUR)), lte(calendarEvents.startsAt, new Date(now.getTime() + BRIEF_WINDOW.toHours * HOUR)), sql`cardinality(${calendarEvents.personIds}) > 0`));
  });
  let made = 0;
  for (const event of due) {
    const outcome = await generateBrief(workspaceId, event.personIds[0]!, { calendarEventId: event.id, automatic: true, ai: options.ai, now });
    if (outcome.kind !== "made") continue;
    made++;
    await withWorkspace(workspaceId, async (tx) => {
      const [owner] = await tx.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, event.userId)).limit(1);
      const [ws] = await tx.select({ timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
      const [brief] = await tx.select({ md: briefs.contentMarkdown, personId: briefs.personId }).from(briefs).where(eq(briefs.id, outcome.briefId)).limit(1);
      if (!owner || !brief) return;
      const when = `${formatDateIn(event.startsAt, ws!.timezone)} at ${formatTimeIn(event.startsAt, ws!.timezone)}`;
      await queueNotification(tx, {
        workspaceId,
        userId: owner.id,
        toEmail: owner.email,
        kind: "brief",
        dedupeKey: `brief:${event.id}`,
        subject: `Brief: ${event.title ?? "Meeting"}, ${when}`.slice(0, 200),
        bodyText: `${brief.md.replace(/^## /gm, "").replace(/^- /gm, "* ")}\n\nOpen the brief: ${appLink(`/people/${brief.personId}?tab=brief&brief=${outcome.briefId}`)}${EMAIL_FOOTER}`,
      });
    });
  }
  return { events: due.length, made };
}
