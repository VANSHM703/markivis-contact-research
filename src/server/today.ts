/** Figures for the Today readout band and the sidebar counts (BRD 16.1, design file 9.4). */
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, min, sql } from "drizzle-orm";
import { budgetOf } from "@/ai/budget";
import { withWorkspace } from "@/db/client";
import { actions, aiCalls, calendarEvents, drafts, feeds, notifications, persons, queueItems, signals } from "@/db/schema";
import type { RequestContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { endOfLocalDay, escalatesAt } from "@/lib/working-days";

export interface TodayFigures {
  actionsDueToday: number;
  actionsOverdue: number;
  draftsAwaitingApproval: number;
  queueItems: number;
  oldestQueueItemAt: Date | null;
}

const OPEN_ACTION = ["open", "drafted", "awaiting_approval", "approved"] as const;

export async function getTodayFigures(workspaceId: string, userId: string, now = new Date(), timeZone = "America/New_York"): Promise<TodayFigures> {
  const endOfToday = endOfLocalDay(now, timeZone);
  return withWorkspace(workspaceId, async (tx) => {
    const [due] = await tx
      .select({
        dueToday: sql<number>`count(*) filter (where ${actions.dueAt} >= ${now} and ${actions.dueAt} <= ${endOfToday})::int`,
        overdue: sql<number>`count(*) filter (where ${actions.dueAt} < ${now})::int`,
      })
      .from(actions)
      .where(and(eq(actions.ownerUserId, userId), inArray(actions.status, [...OPEN_ACTION])));
    const [awaiting] = await tx.select({ n: count() }).from(actions).where(eq(actions.status, "awaiting_approval"));
    const [pendingSignals] = await tx
      .select({ n: count(), oldest: min(signals.foundAt) })
      .from(signals)
      .where(eq(signals.status, "pending"));
    const [pendingItems] = await tx
      .select({ n: count(), oldest: min(queueItems.createdAt) })
      .from(queueItems)
      .where(eq(queueItems.status, "pending"));
    const oldest = [pendingSignals?.oldest, pendingItems?.oldest].filter((d): d is Date => d instanceof Date).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    return {
      actionsDueToday: due?.dueToday ?? 0,
      actionsOverdue: due?.overdue ?? 0,
      draftsAwaitingApproval: awaiting?.n ?? 0,
      queueItems: (pendingSignals?.n ?? 0) + (pendingItems?.n ?? 0),
      oldestQueueItemAt: oldest,
    };
  });
}

export { workingDaysBetween } from "@/lib/working-days";

// ---------------------------------------------------------------------------------------------
// Today panels (BRD 16.2), in order
// ---------------------------------------------------------------------------------------------

export interface TodayAction {
  id: string;
  headline: string;
  personName: string | null;
  dueAt: Date;
  status: string;
  priority: number | null;
  escalated: boolean;
  overdue: boolean;
}

export interface TodayPanels {
  myActions: TodayAction[];
  awaitingApproval: TodayAction[];
  p1Changes: { id: string; headline: string; personId: string; personName: string; confirmedAt: Date | null }[];
  meetings: { id: string; title: string | null; startsAt: Date; personId: string | null; personName: string | null; briefId: string | null }[];
  goingQuiet: { id: string; headline: string; personId: string | null }[];
  queue: { review: number; batch: number; research: number; conflicts: number } | null;
  outcomes: { thisMonth: OutcomeCounts; lastMonth: OutcomeCounts };
  health: { failingFeeds: { name: string; failures: number }[]; aiSpentUsd: number; aiBudgetUsd: number; failedEmails: number } | null;
}

export interface OutcomeCounts {
  sent: number;
  replied: number;
  meeting: number;
  mandate: number;
}

const PANEL_LIMIT = 6;

export async function getTodayPanels(ctx: RequestContext, now = new Date()): Promise<TodayPanels> {
  const tz = ctx.workspace.timezone;
  const endOfToday = endOfLocalDay(now, tz);
  const days = (ctx.workspace.settings as { working_days?: string[] }).working_days;
  return withWorkspace(ctx.workspace.id, async (tx) => {
    const base = {
      id: actions.id,
      headline: sql<string>`coalesce(${actions.headline}, (select s.headline from dmi.signals s where s.id = ${actions.signalId}), 'Action')`,
      personName: persons.fullName,
      dueAt: actions.dueAt,
      status: actions.status,
      priority: sql<number | null>`(select s.priority from dmi.signals s where s.id = ${actions.signalId})`,
    };
    const shape = (r: Omit<TodayAction, "escalated" | "overdue">): TodayAction => ({ ...r, escalated: now >= escalatesAt(r.dueAt, tz, days), overdue: r.dueAt < now });
    const mine = (
      await tx
        .select(base)
        .from(actions)
        .leftJoin(persons, eq(persons.id, actions.personId))
        .where(and(eq(actions.ownerUserId, ctx.user.id), inArray(actions.status, [...OPEN_ACTION]), lte(actions.dueAt, endOfToday)))
        .orderBy(asc(actions.dueAt))
    )
      .map(shape)
      .sort((a, b) => Number(b.escalated) - Number(a.escalated));
    const awaiting = (
      await tx
        .select(base)
        .from(actions)
        .leftJoin(persons, eq(persons.id, actions.personId))
        .where(and(eq(actions.status, "awaiting_approval"), can(ctx.role, "drafts.approve") ? undefined : eq(actions.ownerUserId, ctx.user.id)))
        .orderBy(asc(actions.dueAt))
        .limit(PANEL_LIMIT)
    ).map(shape);

    // Priority 1 changes on my relationships: people I own, or with a strong or warm band.
    const p1Changes = await tx
      .select({ id: signals.id, headline: signals.headline, personId: sql<string>`${signals.personId}`, personName: persons.fullName, confirmedAt: signals.confirmedAt })
      .from(signals)
      .innerJoin(persons, eq(persons.id, signals.personId))
      .where(
        and(
          eq(signals.status, "confirmed"),
          eq(signals.priority, 1),
          gte(signals.confirmedAt, new Date(now.getTime() - 7 * 86_400_000)),
          sql`(${persons.relationshipOwnerId} = ${ctx.user.id} or exists (select 1 from dmi.relationship_scores rs where rs.person_id = ${persons.id} and (rs.user_id = ${ctx.user.id} or rs.user_id is null) and rs.band in ('strong', 'warm')))`,
        ),
      )
      .orderBy(desc(signals.confirmedAt))
      .limit(PANEL_LIMIT);

    const meetings = await tx
      .select({ id: calendarEvents.id, title: calendarEvents.title, startsAt: calendarEvents.startsAt, personId: sql<string | null>`${calendarEvents.personIds}[1]`, personName: sql<string | null>`(select p.full_name from dmi.persons p where p.id = ${calendarEvents.personIds}[1])`, briefId: calendarEvents.briefId })
      .from(calendarEvents)
      .where(and(eq(calendarEvents.userId, ctx.user.id), gte(calendarEvents.startsAt, now), lte(calendarEvents.startsAt, new Date(now.getTime() + 24 * 3_600_000)), sql`cardinality(${calendarEvents.personIds}) > 0`))
      .orderBy(asc(calendarEvents.startsAt));

    const goingQuiet = await tx
      .select({ id: signals.id, headline: signals.headline, personId: signals.personId })
      .from(signals)
      .innerJoin(persons, eq(persons.id, signals.personId))
      .where(and(eq(signals.type, "internal_relationship_quiet"), eq(signals.status, "confirmed"), eq(persons.relationshipOwnerId, ctx.user.id), gte(signals.confirmedAt, new Date(now.getTime() - 30 * 86_400_000))))
      .orderBy(desc(signals.confirmedAt))
      .limit(PANEL_LIMIT);

    let queue: TodayPanels["queue"] = null;
    if (can(ctx.role, "queue.work")) {
      const [lanes] = await tx
        .select({
          review: sql<number>`count(*) filter (where ${signals.status} = 'pending' and ${signals.lane} = 'review')::int`,
          batch: sql<number>`count(*) filter (where ${signals.status} = 'pending' and ${signals.lane} = 'weekly_batch')::int`,
          research: sql<number>`count(*) filter (where ${signals.status} = 'needs_info')::int`,
        })
        .from(signals)
        .where(isNull(signals.mergedIntoId));
      const [conflicts] = await tx.select({ n: count() }).from(queueItems).where(eq(queueItems.status, "pending"));
      queue = { review: lanes?.review ?? 0, batch: lanes?.batch ?? 0, research: lanes?.research ?? 0, conflicts: conflicts?.n ?? 0 };
    }

    // Outcomes this month versus last, for actions sent from this workspace.
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const counts = async (from: Date, to: Date): Promise<OutcomeCounts> => {
      const [row] = await tx
        .select({
          sent: sql<number>`count(distinct ${actions.id})::int`,
          replied: sql<number>`count(distinct ${actions.id}) filter (where ${actions.outcome} = 'replied')::int`,
          meeting: sql<number>`count(distinct ${actions.id}) filter (where ${actions.outcome} = 'meeting')::int`,
          mandate: sql<number>`count(distinct ${actions.id}) filter (where ${actions.outcome} = 'mandate')::int`,
        })
        .from(actions)
        .innerJoin(drafts, eq(drafts.actionId, actions.id))
        .where(and(gte(drafts.sentAt, from), lt(drafts.sentAt, to)));
      return { sent: row?.sent ?? 0, replied: row?.replied ?? 0, meeting: row?.meeting ?? 0, mandate: row?.mandate ?? 0 };
    };
    const outcomes = { thisMonth: await counts(monthStart, new Date(now.getTime() + 1)), lastMonth: await counts(lastMonthStart, monthStart) };

    let health: TodayPanels["health"] = null;
    if (ctx.role === "partner" || ctx.role === "data_steward") {
      const failing = await tx.select({ name: feeds.name, failures: feeds.consecutiveFailures }).from(feeds).where(and(eq(feeds.enabled, true), gte(feeds.consecutiveFailures, 1))).orderBy(desc(feeds.consecutiveFailures));
      const [spent] = await tx.select({ usd: sql<string>`coalesce(sum(${aiCalls.costUsd}), 0)` }).from(aiCalls).where(gte(aiCalls.createdAt, monthStart));
      const [failedMail] = await tx.select({ n: count() }).from(notifications).where(eq(notifications.status, "failed"));
      health = { failingFeeds: failing, aiSpentUsd: Number(spent?.usd ?? 0), aiBudgetUsd: budgetOf(ctx.workspace.settings), failedEmails: failedMail?.n ?? 0 };
    }

    return { myActions: mine, awaitingApproval: awaiting, p1Changes, meetings, goingQuiet, queue, outcomes, health };
  });
}
