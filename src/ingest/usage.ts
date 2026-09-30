/**
 * Monthly metered usage per workspace (BRD 8.1 credit guard). Non-essential work stops at the
 * cap; the data steward is alerted at 80% (the alert is recorded now and emailed from M5).
 */
import { and, eq, sql } from "drizzle-orm";
import { usageCounters } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { WorkspaceCtx } from "./types";

export const periodOf = (d: Date) => d.toISOString().slice(0, 7);

export async function usedThisPeriod(ctx: WorkspaceCtx, provider: string): Promise<number> {
  const [row] = await ctx.tx.select({ units: usageCounters.units }).from(usageCounters).where(and(eq(usageCounters.provider, provider), eq(usageCounters.period, periodOf(ctx.now)))).limit(1);
  return row?.units ?? 0;
}

export class CapReachedError extends Error {}

/** Throws CapReachedError when non-essential work would pass the cap. A null cap means no limit. */
export async function assertUnderCap(ctx: WorkspaceCtx, provider: string, cap: number | null, needed: number, essential: boolean): Promise<void> {
  if (cap === null || essential) return;
  const used = await usedThisPeriod(ctx, provider);
  if (used + needed > cap) throw new CapReachedError(`The monthly ${provider} credit cap of ${cap} is reached (${used} used). Enrichment resumes next month, or raise the cap in Settings.`);
}

export async function recordUsage(ctx: WorkspaceCtx, provider: string, units: number, cap: number | null): Promise<void> {
  if (units <= 0) return;
  const [row] = await ctx.tx
    .insert(usageCounters)
    .values({ workspaceId: ctx.workspaceId, provider, period: periodOf(ctx.now), units })
    .onConflictDoUpdate({ target: [usageCounters.workspaceId, usageCounters.provider, usageCounters.period], set: { units: sql`${usageCounters.units} + ${units}`, updatedAt: new Date() } })
    .returning();
  if (cap !== null && row && !row.alertedAt && row.units >= cap * 0.8) {
    await ctx.tx.update(usageCounters).set({ alertedAt: ctx.now }).where(eq(usageCounters.id, row.id));
    await audit(ctx.tx, { workspaceId: ctx.workspaceId, actorUserId: null, actorKind: "system", action: "usage.alert_80", entityType: "usage_counter", entityId: row.id, after: { provider, used: row.units, cap } });
  }
}
