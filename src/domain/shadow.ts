/**
 * The shadow run (BRD 24.1): live ingestion for 14 days with signals created as `shadow`, seen
 * only by validators and platform admins, to size the validation workload before launch.
 *
 * The report gives raw items and signals per week (by lane and priority), the auto-confirm share,
 * the reject share by feed (validators can reject shadow signals, which also feeds the source
 * reject rates) and the projected validator minutes per week: review items at 1.5 minutes and
 * weekly batch items at 0.25. The go criterion is that projection at or below the workspace's
 * validator_hours_per_week.
 *
 * Go-live promotes shadow signals from the last 7 days into their normal lanes (auto-confirm ones
 * are confirmed, with their actions), discards older ones, keeps the final report in the
 * workspace settings, and switches the shadow flag off.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { signals, workspaces } from "@/db/schema";
import { audit } from "@/lib/audit";
import { confirmSignal } from "@/pipeline/validation";
import { actionsToDraft } from "./actions";

export const REVIEW_MINUTES = 1.5;
export const BATCH_MINUTES = 0.25;
export const SHADOW_DAYS = 14;
export const PROMOTE_DAYS = 7;

/** Signals of the shadow run: still shadow, or rejected by a validator during it. */
const inShadow = sql`(${signals.status} = 'shadow' or ${signals.explanation}->>'shadow_run' = 'true')`;

export interface ShadowWeek {
  week: string;
  rawItems: number;
  signals: number;
  lanes: Record<"auto_confirm" | "review" | "weekly_batch" | "more_research", number>;
  priorities: Record<"1" | "2" | "3", number>;
}

export interface ShadowReport {
  on: boolean;
  startedAt: string | null;
  endsOn: string | null;
  weeks: ShadowWeek[];
  signals: number;
  autoConfirmShare: number;
  rejectByFeed: { sourceType: string; signals: number; rejected: number; share: number }[];
  projectedMinutesPerWeek: number;
  budgetMinutesPerWeek: number;
  goCriterionMet: boolean;
}

interface ShadowState {
  started_at?: string;
  promoted_at?: string;
  final_report?: ShadowReport;
}

async function workspaceState(tx: Tx, workspaceId: string) {
  const [ws] = await tx.select({ flags: workspaces.flags, settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const settings = ws!.settings as { shadow?: ShadowState; validator_hours_per_week?: number };
  return { on: (ws!.flags as Record<string, boolean>)["pipeline.shadow"] === true, state: settings.shadow ?? {}, hours: settings.validator_hours_per_week ?? 5, settings, flags: ws!.flags as Record<string, boolean> };
}

export async function shadowReport(tx: Tx, workspaceId: string, now = new Date()): Promise<ShadowReport> {
  const { on, state, hours } = await workspaceState(tx, workspaceId);
  const [first] = await tx.select({ at: sql<string | null>`min(${signals.foundAt})` }).from(signals).where(inShadow);
  const startedAt = state.started_at ?? (first?.at ? new Date(first.at).toISOString() : null);
  const since = startedAt ? new Date(startedAt) : now;

  const weekly = (
    await tx.execute<{ week: string; lane: string; priority: number; n: number }>(sql`
      select to_char(date_trunc('week', found_at), 'YYYY-MM-DD') as week, lane, priority, count(*)::int as n
      from dmi.signals where ${inShadow} group by 1, 2, 3 order by 1`)
  ).rows;
  const raw = (
    await tx.execute<{ week: string; n: number }>(sql`
      select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week, count(*)::int as n
      from dmi.raw_items where created_at >= ${since.toISOString()}::timestamptz group by 1 order by 1`)
  ).rows;

  const weeks = new Map<string, ShadowWeek>();
  const week = (key: string) => {
    let w = weeks.get(key);
    if (!w) {
      w = { week: key, rawItems: 0, signals: 0, lanes: { auto_confirm: 0, review: 0, weekly_batch: 0, more_research: 0 }, priorities: { 1: 0, 2: 0, 3: 0 } };
      weeks.set(key, w);
    }
    return w;
  };
  for (const r of raw) week(r.week).rawItems = r.n;
  let total = 0;
  let auto = 0;
  let minutes = 0;
  for (const r of weekly) {
    const w = week(r.week);
    w.signals += r.n;
    w.lanes[r.lane as keyof ShadowWeek["lanes"]] += r.n;
    w.priorities[String(r.priority) as "1" | "2" | "3"] += r.n;
    total += r.n;
    if (r.lane === "auto_confirm") auto += r.n;
    if (r.lane === "review" || r.lane === "more_research") minutes += r.n * REVIEW_MINUTES;
    if (r.lane === "weekly_batch") minutes += r.n * BATCH_MINUTES;
  }

  const byFeed = (
    await tx.execute<{ source_type: string; n: number; rejected: number }>(sql`
      select ss.source_type, count(distinct signals.id)::int as n, count(distinct signals.id) filter (where signals.status = 'rejected')::int as rejected
      from dmi.signals join dmi.signal_sources ss on ss.signal_id = signals.id
      where ${inShadow} group by 1 order by 2 desc`)
  ).rows;

  const elapsedWeeks = Math.max(1, Math.ceil((now.getTime() - since.getTime()) / (7 * 86_400_000)));
  const projected = Math.round((minutes / elapsedWeeks) * 10) / 10;
  const budget = hours * 60;
  return {
    on,
    startedAt,
    endsOn: startedAt ? new Date(new Date(startedAt).getTime() + SHADOW_DAYS * 86_400_000).toISOString().slice(0, 10) : null,
    weeks: Array.from(weeks.values()).sort((a, b) => a.week.localeCompare(b.week)),
    signals: total,
    autoConfirmShare: total ? auto / total : 0,
    rejectByFeed: byFeed.map((f) => ({ sourceType: f.source_type, signals: f.n, rejected: f.rejected, share: f.n ? f.rejected / f.n : 0 })),
    projectedMinutesPerWeek: projected,
    budgetMinutesPerWeek: budget,
    goCriterionMet: projected <= budget,
  };
}

interface ShadowActor {
  workspaceId: string;
  userId: string;
}

/** Starts the shadow run: new signals are created as shadow from now on. */
export async function startShadowRun(tx: Tx, actor: ShadowActor, now = new Date()): Promise<void> {
  const { on, settings, flags } = await workspaceState(tx, actor.workspaceId);
  if (on) return;
  await tx.update(workspaces).set({ flags: { ...flags, "pipeline.shadow": true }, settings: { ...settings, shadow: { started_at: now.toISOString() } } }).where(eq(workspaces.id, actor.workspaceId));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "platform_admin", action: "shadow.started", entityType: "workspace", entityId: actor.workspaceId, after: { started_at: now.toISOString() } });
}

/** Go-live (BRD 24.1). Returns what moved; the actions to draft go to the caller. */
export async function promoteShadow(tx: Tx, actor: ShadowActor, now = new Date()): Promise<{ promoted: number; confirmed: number; discarded: number; toDraft: string[] }> {
  const { settings, flags } = await workspaceState(tx, actor.workspaceId);
  const report = await shadowReport(tx, actor.workspaceId, now);
  const cutoff = new Date(now.getTime() - PROMOTE_DAYS * 86_400_000);

  const discarded = await tx.delete(signals).where(and(eq(signals.status, "shadow"), lt(signals.foundAt, cutoff))).returning({ id: signals.id });
  const recent = await tx.select({ id: signals.id, lane: signals.lane }).from(signals).where(and(eq(signals.status, "shadow"), gte(signals.foundAt, cutoff)));
  let confirmed = 0;
  const toDraft: string[] = [];
  for (const s of recent) {
    await tx.update(signals).set({ status: "pending" }).where(eq(signals.id, s.id));
    if (s.lane === "auto_confirm") {
      const { action } = await confirmSignal(tx, { workspaceId: actor.workspaceId, userId: null, kind: "system" }, s.id, { auto: true, now });
      toDraft.push(...actionsToDraft(action));
      confirmed++;
    }
  }
  await tx
    .update(workspaces)
    .set({ flags: { ...flags, "pipeline.shadow": false }, settings: { ...settings, shadow: { ...(settings.shadow ?? {}), promoted_at: now.toISOString(), final_report: report } } })
    .where(eq(workspaces.id, actor.workspaceId));
  await audit(tx, {
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    actorKind: "platform_admin",
    action: "shadow.promoted",
    entityType: "workspace",
    entityId: actor.workspaceId,
    after: { promoted: recent.length, confirmed, discarded: discarded.length, projected_minutes_per_week: report.projectedMinutesPerWeek, budget_minutes_per_week: report.budgetMinutesPerWeek, go_criterion_met: report.goCriterionMet },
  });
  return { promoted: recent.length, confirmed, discarded: discarded.length, toDraft };
}
