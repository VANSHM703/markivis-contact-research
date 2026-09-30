/**
 * Relationship strength (BRD 11.4), as a pure function of a person's interactions:
 *
 *   R  = exp(-days_since_last_two_way / 90)               0 if never two-way
 *   F  = min(1, two_way_touches_12m / 12)                 a touch: a two-way email thread, a meeting or a call
 *   Rc = inbound_threads_12m / max(1, all_threads_12m)    threads where the person wrote at least once
 *   D  = min(1, (3*meetings + 2*calls + 1*email_threads + 0.5*linkedin_units) / 20)
 *   T  = min(1, years_since_first_two_way / 5)
 *   score = round(100 * (wR*R + wF*F + wRc*Rc + wD*D + wT*T))
 *
 * A thread is two-way when it has a message in each direction within 30 days. Newsletter opens
 * weigh zero; newsletter clicks, events and interviews count as LinkedIn units in D only. Inputs
 * use the trailing 12 months before `asOf`, except T, which looks back to the first two-way touch.
 */

export type Band = "strong" | "warm" | "cooling" | "cold" | "none";

export interface ScoreInteraction {
  channel: string;
  direction: string;
  occurredAt: Date;
  threadKey: string | null;
}

export interface ScoringSettings {
  weights: { recency: number; frequency: number; reciprocity: number; depth: number; tenure: number };
  recency_half_scale_days: number;
  bands: { strong: number; warm: number; cooling: number; cold: number };
}

export const DEFAULT_SCORING: ScoringSettings = {
  weights: { recency: 0.3, frequency: 0.25, reciprocity: 0.2, depth: 0.15, tenure: 0.1 },
  recency_half_scale_days: 90,
  bands: { strong: 70, warm: 45, cooling: 25, cold: 1 },
};

export function scoringSettings(settings: Record<string, unknown> | null | undefined): ScoringSettings {
  const s = (settings?.scoring ?? {}) as Partial<ScoringSettings>;
  return {
    weights: { ...DEFAULT_SCORING.weights, ...(s.weights ?? {}) },
    recency_half_scale_days: s.recency_half_scale_days ?? DEFAULT_SCORING.recency_half_scale_days,
    bands: { ...DEFAULT_SCORING.bands, ...(s.bands ?? {}) },
  };
}

export interface Factor<R> {
  raw: R;
  value: number;
}

export interface Factors {
  recency: Factor<{ daysSinceLastTwoWay: number | null }>;
  frequency: Factor<{ twoWayTouches12m: number }>;
  reciprocity: Factor<{ inboundThreads12m: number; threads12m: number }>;
  depth: Factor<{ meetings: number; calls: number; emailThreads: number; linkedinUnits: number }>;
  tenure: Factor<{ yearsSinceFirstTwoWay: number | null }>;
}

export interface ScoreResult {
  score: number;
  band: Band;
  factors: Factors;
  lastTwoWayAt: Date | null;
}

const DAY = 86_400_000;
const TWO_WAY_WINDOW = 30 * DAY;
const LINKEDIN_UNITS = new Set(["linkedin_message", "linkedin_request", "newsletter_click", "event", "interview"]);

export function bandOf(score: number, bands: ScoringSettings["bands"], anyInteraction = true): Band {
  if (!anyInteraction || score <= 0) return "none";
  if (score >= bands.strong) return "strong";
  if (score >= bands.warm) return "warm";
  if (score >= bands.cooling) return "cooling";
  return score >= bands.cold ? "cold" : "none";
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

interface Thread {
  messages: ScoreInteraction[];
  inbound: boolean;
  /** When the thread became two-way (the later message of the first opposite-direction pair within 30 days). */
  twoWayAt: Date | null;
  lastAt: Date;
}

function threadsOf(emails: ScoreInteraction[]): Thread[] {
  const groups = new Map<string, ScoreInteraction[]>();
  emails.forEach((e, i) => {
    const key = e.threadKey ?? `single:${i}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  });
  return Array.from(groups.values()).map((messages) => {
    const sorted = [...messages].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    let twoWayAt: Date | null = null;
    const isOut = (m: ScoreInteraction) => m.direction === "outbound" || m.direction === "two_way";
    const isIn = (m: ScoreInteraction) => m.direction === "inbound" || m.direction === "two_way";
    for (let i = 0; i < sorted.length && !twoWayAt; i++) {
      if (sorted[i]!.direction === "two_way") twoWayAt = sorted[i]!.occurredAt;
      for (let j = i + 1; j < sorted.length && !twoWayAt; j++) {
        const a = sorted[i]!;
        const b = sorted[j]!;
        if (b.occurredAt.getTime() - a.occurredAt.getTime() > TWO_WAY_WINDOW) break;
        if ((isOut(a) && isIn(b)) || (isIn(a) && isOut(b))) twoWayAt = b.occurredAt;
      }
    }
    return { messages: sorted, inbound: sorted.some(isIn), twoWayAt, lastAt: sorted.at(-1)!.occurredAt };
  });
}

export function computeScore(all: ScoreInteraction[], asOf: Date, settings: ScoringSettings = DEFAULT_SCORING): ScoreResult {
  const rows = all.filter((r) => r.occurredAt <= asOf && r.channel !== "newsletter_open");
  const from = asOf.getTime() - 365 * DAY;
  const inWindow = (d: Date) => d.getTime() > from;

  const threads = threadsOf(rows.filter((r) => r.channel === "email"));
  const meetings = rows.filter((r) => r.channel === "meeting");
  const calls = rows.filter((r) => r.channel === "call");

  // Two-way touches, all time: two-way threads, meetings and calls.
  const touches = [...threads.flatMap((t) => (t.twoWayAt ? [t.twoWayAt] : [])), ...meetings.map((m) => m.occurredAt), ...calls.map((c) => c.occurredAt)].sort((a, b) => a.getTime() - b.getTime());
  const last = touches.at(-1) ?? null;
  const first = touches[0] ?? null;

  const daysSince = last ? (asOf.getTime() - last.getTime()) / DAY : null;
  const R = daysSince === null ? 0 : Math.exp(-daysSince / settings.recency_half_scale_days);
  const touches12 = touches.filter(inWindow).length;
  const F = Math.min(1, touches12 / 12);
  const threads12 = threads.filter((t) => inWindow(t.lastAt));
  const inbound12 = threads12.filter((t) => t.inbound).length;
  const Rc = inbound12 / Math.max(1, threads12.length);
  const m12 = meetings.filter((m) => inWindow(m.occurredAt)).length;
  const c12 = calls.filter((c) => inWindow(c.occurredAt)).length;
  const li12 = rows.filter((r) => LINKEDIN_UNITS.has(r.channel) && inWindow(r.occurredAt)).length;
  const D = Math.min(1, (3 * m12 + 2 * c12 + 1 * threads12.length + 0.5 * li12) / 20);
  const years = first ? (asOf.getTime() - first.getTime()) / (365.25 * DAY) : null;
  const T = years === null ? 0 : Math.min(1, years / 5);

  const w = settings.weights;
  const score = Math.round(100 * (w.recency * R + w.frequency * F + w.reciprocity * Rc + w.depth * D + w.tenure * T));
  return {
    score,
    band: bandOf(score, settings.bands, rows.length > 0),
    lastTwoWayAt: last,
    factors: {
      recency: { raw: { daysSinceLastTwoWay: daysSince === null ? null : Math.floor(daysSince) }, value: round3(R) },
      frequency: { raw: { twoWayTouches12m: touches12 }, value: round3(F) },
      reciprocity: { raw: { inboundThreads12m: inbound12, threads12m: threads12.length }, value: round3(Rc) },
      depth: { raw: { meetings: m12, calls: c12, emailThreads: threads12.length, linkedinUnits: li12 }, value: round3(D) },
      tenure: { raw: { yearsSinceFirstTwoWay: years === null ? null : Math.round(years * 10) / 10 }, value: round3(T) },
    },
  };
}

/** Spearman rank correlation between two equal-length lists (BRD 11.4 calibration). Ties get average ranks. */
export function spearman(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length < 2) return 0;
  const rank = (xs: number[]) => {
    const order = xs.map((x, i) => ({ x, i })).sort((p, q) => p.x - q.x);
    const ranks = new Array<number>(xs.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]!.x === order[i]!.x) j++;
      for (let k = i; k <= j; k++) ranks[order[k]!.i] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return ranks;
  };
  const ra = rank(a);
  const rb = rank(b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}
