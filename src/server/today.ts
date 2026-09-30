/** Figures for the Today readout band and the sidebar counts (BRD 16.1, design file 9.4). */
import { and, count, eq, inArray, min, sql } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { actions, queueItems, signals } from "@/db/schema";

export interface TodayFigures {
  actionsDueToday: number;
  actionsOverdue: number;
  draftsAwaitingApproval: number;
  queueItems: number;
  oldestQueueItemAt: Date | null;
}

const OPEN_ACTION = ["open", "drafted", "awaiting_approval", "approved"] as const;

export async function getTodayFigures(workspaceId: string, userId: string, now = new Date()): Promise<TodayFigures> {
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
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

/** Working days between two dates, counting Monday to Friday only (BRD 10.3). */
export function workingDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let days = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days++;
  }
  return days;
}
