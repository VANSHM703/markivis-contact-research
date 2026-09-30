/**
 * Validation (BRD 10.2 to 10.6): confirm, reject, more research (at most two cycles), park, the
 * weekly batch, auto-confirm spot checks with suspension, and per-feed weekly stats.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { SignalType } from "@/ai/contracts";
import { AiOutputError, getAi, type AiAdapter } from "@/ai/adapter";
import { AiBudgetPausedError, assertAiAllowed, recordAiCall } from "@/ai/budget";
import { withWorkspace, type Tx } from "@/db/client";
import { companies, feeds, persons, rawItems, signals, signalSources, sourceStatsWeekly, workspaces } from "@/db/schema";
import { createActionForSignal, type CreatedAction } from "@/domain/actions";
import { addRole, endRole, type Actor, type SourceNote } from "@/domain/records";
import { audit } from "@/lib/audit";
import { weekStart } from "@/lib/working-days";
import type { ProposedChange } from "./process";
import { combineConfidence, SIGNAL_RULES, type Confidence, type SourceFacts } from "./rules";

export const MAX_RESEARCH_CYCLES = 2;
export const SPOT_CHECK_DEFAULTS = { share: 0.1, minimum: 5, suspendErrorRate: 0.02 };

export class ValidationError extends Error {}

type Signal = typeof signals.$inferSelect;

async function load(tx: Tx, id: string): Promise<Signal> {
  const [s] = await tx.select().from(signals).where(eq(signals.id, id)).limit(1);
  if (!s) throw new ValidationError("That item no longer exists.");
  return s;
}

async function settingsOf(tx: Tx, workspaceId: string) {
  const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return { settings: (ws!.settings ?? {}) as Record<string, unknown>, timezone: ws!.timezone };
}

// ---------------------------------------------------------------------------------------------
// Confirm, with record changes and the action
// ---------------------------------------------------------------------------------------------

export interface SignalEdits {
  headline?: string;
  type?: SignalType;
  priority?: 1 | 2 | 3;
  confidence?: Confidence;
  eventOn?: string | null;
  effectiveOn?: string | null;
}

async function applyChanges(tx: Tx, actor: Actor, signal: Signal): Promise<void> {
  const [source] = await tx.select().from(signalSources).where(eq(signalSources.signalId, signal.id)).limit(1);
  const note: SourceNote = { sourceType: source?.sourceType ?? "manual", sourceUrl: source?.url ?? null, confidence: signal.confidence, note: `Confirmed change: ${signal.headline}` };
  for (const change of signal.proposedChanges as ProposedChange[]) {
    if (change.kind === "end_role") await endRole(tx, actor, change.role_id, change.ended_on, note);
    else if (change.kind === "add_role") await addRole(tx, actor, change.person_id, { companyId: change.company_id, title: change.title, effectiveOn: change.effective_on, announcedOn: change.announced_on }, note);
    else if (change.kind === "set_off_list") await tx.update(persons).set({ isOffList: true }).where(eq(persons.id, change.person_id));
  }
}

export interface ConfirmResult {
  action: CreatedAction | null;
}

export async function confirmSignal(tx: Tx, actor: Actor, signalId: string, options: { auto?: boolean; now?: Date; edits?: SignalEdits } = {}): Promise<ConfirmResult> {
  const now = options.now ?? new Date();
  let signal = await load(tx, signalId);
  if (signal.status === "confirmed") return { action: null };
  if (signal.status === "rejected") throw new ValidationError("This item was already rejected.");

  const edits = options.edits ?? {};
  const changed = Object.fromEntries(Object.entries(edits).filter(([k, v]) => v !== undefined && (signal as Record<string, unknown>)[k] !== v));
  const [updated] = await tx
    .update(signals)
    .set({ ...changed, status: "confirmed", validatedBy: options.auto ? null : actor.userId, validatedAt: now, confirmedAt: now })
    .where(eq(signals.id, signalId))
    .returning();
  signal = updated!;
  await applyChanges(tx, actor, signal!);
  const action = await createActionForSignal(tx, signal!, now);
  await audit(tx, {
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    actorKind: options.auto ? "system" : "user",
    action: options.auto ? "signal.auto_confirmed" : "signal.confirmed",
    entityType: "signal",
    entityId: signalId,
    ...(Object.keys(changed).length ? { after: { edits: changed } } : {}),
  });
  await refreshStatsFor(tx, signal!, now);
  return { action };
}

// ---------------------------------------------------------------------------------------------
// Reject, park, more research
// ---------------------------------------------------------------------------------------------

export const REJECT_REASONS = ["wrong_person", "not_a_change", "duplicate", "out_of_date", "not_relevant"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export async function rejectSignal(tx: Tx, actor: Actor, signalId: string, reason: RejectReason, now = new Date()): Promise<void> {
  if (!REJECT_REASONS.includes(reason)) throw new ValidationError("Choose a reason for rejecting.");
  const signal = await load(tx, signalId);
  if (signal.status === "confirmed" || signal.status === "rejected") throw new ValidationError("This item has already been decided.");
  const [updated] = await tx.update(signals).set({ status: "rejected", rejectReason: reason, validatedBy: actor.userId, validatedAt: now }).where(eq(signals.id, signalId)).returning();
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "signal.rejected", entityType: "signal", entityId: signalId, after: { reason } });
  await refreshStatsFor(tx, updated!, now);
}

export async function parkSignal(tx: Tx, actor: Actor, signalId: string): Promise<void> {
  const signal = await load(tx, signalId);
  if (signal.status === "confirmed" || signal.status === "rejected") throw new ValidationError("This item has already been decided.");
  await tx.update(signals).set({ status: "parked" }).where(eq(signals.id, signalId));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "signal.parked", entityType: "signal", entityId: signalId });
}

export function canResearch(signal: Pick<Signal, "researchCycles" | "status">): boolean {
  return signal.researchCycles < MAX_RESEARCH_CYCLES && !["confirmed", "rejected", "needs_info"].includes(signal.status);
}

/** Sends the item for AI research; after two cycles only confirm, reject and park remain (BRD 10.2). */
export async function requestResearch(tx: Tx, actor: Actor, signalId: string): Promise<void> {
  const signal = await load(tx, signalId);
  if (!canResearch(signal)) throw new ValidationError(signal.researchCycles >= MAX_RESEARCH_CYCLES ? "This item has had two research cycles. Confirm, reject or park it." : "This item cannot be researched now.");
  await tx.update(signals).set({ lane: "more_research", status: "needs_info", researchCycles: signal.researchCycles + 1 }).where(eq(signals.id, signalId));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "signal.research_requested", entityType: "signal", entityId: signalId, after: { cycle: signal.researchCycles + 1 } });
}

/**
 * Runs the research step once (BRD 17.3 research_more) and returns the item to review with any
 * sources found. The AI never confirms. Research is skipped when AI_WEB_SEARCH is not "true" in
 * live mode, or when the AI budget is used up.
 */
export async function completeResearch(workspaceId: string, signalId: string, options: { ai?: AiAdapter; now?: () => Date } = {}): Promise<{ verdict: string; added: number }> {
  const now = options.now ?? (() => new Date());
  const ai = options.ai ?? (await getAi(undefined, now));
  const prepared = await withWorkspace(workspaceId, async (tx) => {
    const signal = await load(tx, signalId);
    const { settings } = await settingsOf(tx, workspaceId);
    const sources = await tx.select().from(signalSources).where(eq(signalSources.signalId, signalId));
    let skip: string | null = null;
    if (ai.mode === "live" && process.env.AI_WEB_SEARCH !== "true") skip = "Research is disabled";
    try {
      await assertAiAllowed(tx, settings, "research", now());
    } catch (error) {
      if (error instanceof AiBudgetPausedError) skip = "Research is paused: the monthly AI budget is used up";
      else throw error;
    }
    return { signal, settings, sources, skip };
  });

  const back = async (note: Record<string, unknown>, extra: (tx: Tx) => Promise<number> = async () => 0) =>
    withWorkspace(workspaceId, async (tx) => {
      const added = await extra(tx);
      const signal = await load(tx, signalId);
      await tx.update(signals).set({ lane: "review", status: "pending", researchNotes: [...(signal.researchNotes as object[]), { ...note, at: now().toISOString() }] }).where(eq(signals.id, signalId));
      return added;
    });

  if (prepared.skip) {
    await back({ verdict: "skipped", note: prepared.skip });
    return { verdict: "skipped", added: 0 };
  }
  let result;
  try {
    result = await ai.researchMore({
      signalId,
      signalType: prepared.signal.type,
      headline: prepared.signal.headline,
      eventOn: prepared.signal.eventOn,
      sources: prepared.sources.map((s) => ({ url: s.url, title: s.title, publishedAt: s.publishedAt?.toISOString() ?? null })),
    });
  } catch (error) {
    if (!(error instanceof AiOutputError)) throw error;
    await withWorkspace(workspaceId, (tx) => recordAiCall(tx, workspaceId, error.call, prepared.settings, now()));
    await back({ verdict: "failed", note: "Research could not finish. Decide from the sources shown." });
    return { verdict: "failed", added: 0 };
  }
  const added = await back({ verdict: result.output.verdict, note: result.output.note }, async (tx) => {
    await recordAiCall(tx, workspaceId, result.call, prepared.settings, now());
    const known = new Set(prepared.sources.map((s) => s.url));
    const fresh = result.output.sources.filter((s) => s.supports && !known.has(s.url));
    for (const s of fresh) {
      await tx.insert(signalSources).values({ workspaceId, signalId, rawItemId: null, sourceType: "ai_research", url: s.url, title: s.title, publishedAt: s.published_date ? new Date(`${s.published_date}T00:00:00Z`) : null });
    }
    // Recompute confidence with the research sources included (BRD 9.4).
    const all = await tx.select().from(signalSources).where(eq(signalSources.signalId, signalId));
    const [company] = prepared.signal.companyId ? await tx.select({ domain: companies.domain }).from(companies).where(eq(companies.id, prepared.signal.companyId)).limit(1) : [];
    const facts: SourceFacts[] = all.map((s) => ({ rawItemId: s.rawItemId, sourceType: s.sourceType, url: s.url, quoted: true }));
    const c = combineConfidence(facts, { companyDomain: company?.domain ?? null, reputableOutlets: (prepared.settings.reputable_outlets as string[] | undefined) ?? [] });
    await tx.update(signals).set({ confidence: c.confidence }).where(eq(signals.id, signalId));
    return fresh.length;
  });
  return { verdict: result.output.verdict, added };
}

// ---------------------------------------------------------------------------------------------
// Weekly batch (BRD 10.5)
// ---------------------------------------------------------------------------------------------

/** Confirms every listed weekly-batch item in one action; each confirmation is logged on its own. */
export async function approveBatch(tx: Tx, actor: Actor, signalIds: string[], now = new Date()): Promise<{ confirmed: number; actions: CreatedAction[] }> {
  if (signalIds.length === 0) return { confirmed: 0, actions: [] };
  const rows = await tx.select().from(signals).where(and(inArray(signals.id, signalIds), eq(signals.lane, "weekly_batch"), eq(signals.status, "pending")));
  const created: CreatedAction[] = [];
  for (const s of rows) {
    const { action } = await confirmSignal(tx, actor, s.id, { now });
    if (action) created.push(action);
  }
  return { confirmed: rows.length, actions: created };
}

// ---------------------------------------------------------------------------------------------
// Spot checks and suspension (BRD 10.6)
// ---------------------------------------------------------------------------------------------

function spotSettings(settings: Record<string, unknown>) {
  const v = (settings.validation ?? {}) as { spot_check_share?: number; spot_check_min?: number; suspend_error_rate?: number };
  return { share: v.spot_check_share ?? SPOT_CHECK_DEFAULTS.share, minimum: v.spot_check_min ?? SPOT_CHECK_DEFAULTS.minimum, suspendErrorRate: v.suspend_error_rate ?? SPOT_CHECK_DEFAULTS.suspendErrorRate };
}

/** Samples last week's auto-confirmed signals: 10%, at least 5, or all if fewer. Idempotent per week. */
export async function sampleSpotChecks(tx: Tx, workspaceId: string, now = new Date()): Promise<number> {
  const { settings, timezone } = await settingsOf(tx, workspaceId);
  const thisWeek = weekStart(now, timezone);
  const lastWeek = new Date(`${thisWeek}T12:00:00Z`);
  lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
  const from = lastWeek.toISOString().slice(0, 10);
  const inWeek = sql`(${signals.confirmedAt} at time zone ${timezone})::date >= ${from}::date and (${signals.confirmedAt} at time zone ${timezone})::date < ${thisWeek}::date`;
  const auto = await tx.select({ id: signals.id, spot: signals.isSpotCheck }).from(signals).where(and(eq(signals.lane, "auto_confirm"), eq(signals.status, "confirmed"), isNull(signals.validatedBy), inWeek));
  if (auto.some((a) => a.spot)) return 0;
  const { share, minimum } = spotSettings(settings);
  const size = Math.min(auto.length, Math.max(minimum, Math.ceil(auto.length * share)));
  // Deterministic sample: order by a hash of the ID, so a rerun picks the same items.
  const picked = [...auto].sort((a, b) => hash(a.id) - hash(b.id)).slice(0, size).map((a) => a.id);
  if (picked.length) await tx.update(signals).set({ isSpotCheck: true }).where(inArray(signals.id, picked));
  return picked.length;
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * Records a spot-check result. If a source type's error rate in that week's sample exceeds the
 * threshold (default 2%), auto-confirm is suspended for it until a partner or data steward
 * re-enables it. Returns the source types newly suspended.
 */
export async function markSpotCheck(tx: Tx, actor: Actor, signalId: string, result: "correct" | "incorrect", now = new Date()): Promise<string[]> {
  const signal = await load(tx, signalId);
  if (!signal.isSpotCheck) throw new ValidationError("This item is not a spot check.");
  await tx.update(signals).set({ spotCheckResult: result }).where(eq(signals.id, signalId));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "spot_check.marked", entityType: "signal", entityId: signalId, after: { result } });
  await refreshStatsFor(tx, signal, now);
  if (result === "correct") return [];

  const { settings } = await settingsOf(tx, actor.workspaceId);
  const { suspendErrorRate } = spotSettings(settings);
  const sources = [...new Set((await tx.select({ t: signalSources.sourceType }).from(signalSources).where(eq(signalSources.signalId, signalId))).map((r) => r.t))];
  const suspended: string[] = [];
  const current = ((settings.validation as { suspended_sources?: Record<string, unknown> } | undefined)?.suspended_sources ?? {}) as Record<string, unknown>;
  for (const sourceType of sources) {
    if (current[sourceType]) continue;
    const sample = await tx
      .select({ result: signals.spotCheckResult })
      .from(signals)
      .innerJoin(signalSources, eq(signalSources.signalId, signals.id))
      .where(and(eq(signals.isSpotCheck, true), eq(signalSources.sourceType, sourceType), sql`${signals.confirmedAt} >= ${signal.confirmedAt ?? now}::timestamptz - interval '7 days'`, sql`${signals.confirmedAt} <= ${signal.confirmedAt ?? now}::timestamptz + interval '7 days'`));
    const incorrect = sample.filter((s) => s.result === "incorrect").length;
    if (sample.length > 0 && incorrect / sample.length > suspendErrorRate) suspended.push(sourceType);
  }
  if (suspended.length) {
    const validation = (settings.validation ?? {}) as Record<string, unknown>;
    const next = { ...current, ...Object.fromEntries(suspended.map((t) => [t, { since: now.toISOString(), reason: "Spot-check error rate above the threshold" }])) };
    await tx.update(workspaces).set({ settings: { ...settings, validation: { ...validation, suspended_sources: next } } }).where(eq(workspaces.id, actor.workspaceId));
    for (const t of suspended) await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "system", action: "auto_confirm.suspended", after: { source_type: t } });
  }
  return suspended;
}

export async function reenableAutoConfirm(tx: Tx, actor: Actor, sourceType: string): Promise<void> {
  const { settings } = await settingsOf(tx, actor.workspaceId);
  const validation = (settings.validation ?? {}) as { suspended_sources?: Record<string, unknown> };
  const { [sourceType]: _removed, ...rest } = validation.suspended_sources ?? {};
  await tx.update(workspaces).set({ settings: { ...settings, validation: { ...validation, suspended_sources: rest } } }).where(eq(workspaces.id, actor.workspaceId));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "auto_confirm.reenabled", after: { source_type: sourceType } });
}

export function suspendedSourceTypes(settings: Record<string, unknown>): { sourceType: string; since: string }[] {
  const s = ((settings.validation as { suspended_sources?: Record<string, { since: string }> } | undefined)?.suspended_sources ?? {}) as Record<string, { since: string }>;
  return Object.entries(s).map(([sourceType, v]) => ({ sourceType, since: v.since }));
}

// ---------------------------------------------------------------------------------------------
// Weekly stats per feed (BRD 10.6, stats.sources)
// ---------------------------------------------------------------------------------------------

async function refreshStatsFor(tx: Tx, signal: Pick<Signal, "id" | "workspaceId">, now: Date): Promise<void> {
  const feedIds = (
    await tx.selectDistinct({ feedId: rawItems.feedId }).from(signalSources).innerJoin(rawItems, eq(rawItems.id, signalSources.rawItemId)).where(eq(signalSources.signalId, signal.id))
  )
    .map((r) => r.feedId)
    .filter((f): f is string => !!f);
  const { timezone } = await settingsOf(tx, signal.workspaceId);
  for (const feedId of feedIds) await recomputeFeedWeek(tx, signal.workspaceId, feedId, weekStart(now, timezone), timezone);
}

/** Rebuilds one feed's counters for one week from the records, so it is always exact and idempotent. */
export async function recomputeFeedWeek(tx: Tx, workspaceId: string, feedId: string, week: string, timezone: string): Promise<void> {
  const local = (col: unknown) => sql`(${col} at time zone ${timezone})::date`;
  const inWeek = (col: unknown) => sql`${local(col)} >= ${week}::date and ${local(col)} < ${week}::date + 7`;
  const viaFeed = sql`exists (select 1 from ${signalSources} ss join ${rawItems} ri on ri.id = ss.raw_item_id where ss.signal_id = ${signals}.id and ri.feed_id = ${feedId})`;
  const [raw] = await tx.select({ n: sql<number>`count(*)::int` }).from(rawItems).where(and(eq(rawItems.feedId, feedId), inWeek(rawItems.createdAt)));
  const [row] = await tx
    .select({
      created: sql<number>`count(*) filter (where ${inWeek(signals.createdAt)})::int`,
      confirmed: sql<number>`count(*) filter (where ${signals.status} = 'confirmed' and ${inWeek(signals.confirmedAt)})::int`,
      rejected: sql<number>`count(*) filter (where ${signals.status} = 'rejected' and ${inWeek(signals.validatedAt)})::int`,
      auto: sql<number>`count(*) filter (where ${signals.status} = 'confirmed' and ${signals.validatedBy} is null and ${signals.lane} = 'auto_confirm' and ${inWeek(signals.confirmedAt)})::int`,
      spotErrors: sql<number>`count(*) filter (where ${signals.spotCheckResult} = 'incorrect' and ${inWeek(signals.confirmedAt)})::int`,
    })
    .from(signals)
    .where(viaFeed);
  const values = { rawItems: raw?.n ?? 0, signalsCreated: row?.created ?? 0, confirmed: row?.confirmed ?? 0, rejected: row?.rejected ?? 0, autoConfirmed: row?.auto ?? 0, spotCheckErrors: row?.spotErrors ?? 0 };
  await tx
    .insert(sourceStatsWeekly)
    .values({ workspaceId, feedId, weekStart: week, ...values })
    .onConflictDoUpdate({ target: [sourceStatsWeekly.feedId, sourceStatsWeekly.weekStart], set: values });
}

/** Rebuilds last week's and this week's stats for every feed (the weekly stats.sources job). */
export async function recomputeAllStats(tx: Tx, workspaceId: string, now = new Date()): Promise<void> {
  const { timezone } = await settingsOf(tx, workspaceId);
  const thisWeek = weekStart(now, timezone);
  const prior = new Date(`${thisWeek}T12:00:00Z`);
  prior.setUTCDate(prior.getUTCDate() - 7);
  for (const feed of await tx.select({ id: feeds.id }).from(feeds)) {
    for (const week of [prior.toISOString().slice(0, 10), thisWeek]) await recomputeFeedWeek(tx, workspaceId, feed.id, week, timezone);
  }
}

/** Feeds rejected more than half the time for four weeks running (BRD 10.6), for data health. */
export async function noisyFeeds(tx: Tx): Promise<string[]> {
  const rows = await tx.select().from(sourceStatsWeekly).orderBy(sourceStatsWeekly.feedId, sql`${sourceStatsWeekly.weekStart} desc`);
  const byFeed = new Map<string, typeof rows>();
  for (const r of rows) byFeed.set(r.feedId, [...(byFeed.get(r.feedId) ?? []), r]);
  return [...byFeed.entries()]
    .filter(([, weeks]) => weeks.length >= 4 && weeks.slice(0, 4).every((w) => w.confirmed + w.rejected > 0 && w.rejected / (w.confirmed + w.rejected) > 0.5))
    .map(([feedId]) => feedId);
}

export { SIGNAL_RULES };
