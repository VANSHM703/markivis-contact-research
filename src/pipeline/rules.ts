/**
 * Signal pipeline rules (BRD 9.3, 9.4, 9.5, 10.1 and the 7.3 priority overrides). Pure functions,
 * unit tested; the orchestrator in process.ts applies them in order.
 */
import type { SignalType } from "@/ai/contracts";
import { isoWeek } from "@/lib/working-days";

export type ActionType = "congratulate" | "check_in" | "introduction_request" | "invite_interview" | "invite_event" | "share_content" | "pause" | "reengage" | "custom";
export type Confidence = "high" | "medium" | "low";
export type Lane = "auto_confirm" | "review" | "weekly_batch" | "more_research";

export interface SignalRule {
  subject: "person" | "company" | "either";
  priority: 1 | 2 | 3;
  /** Eligible for the auto-confirm lane; null means not applicable (rule-raised signals). */
  autoConfirm: boolean | null;
  action: ActionType | null;
  why: string;
}

/** BRD 9.3, row for row. `other` defaults to priority 3; a validator sets its real priority. */
export const SIGNAL_RULES: Record<SignalType, SignalRule> = {
  person_move_announced: { subject: "person", priority: 1, autoConfirm: true, action: "congratulate", why: "Reach them before the new seat fills their calendar" },
  person_left: { subject: "person", priority: 1, autoConfirm: true, action: "check_in", why: "Find out what is next while the move is fresh" },
  person_joined: { subject: "person", priority: 1, autoConfirm: true, action: "congratulate", why: "New leaders review their bench early" },
  person_board_change: { subject: "person", priority: 1, autoConfirm: true, action: "congratulate", why: "Board seats shape succession decisions" },
  company_cxo_change: { subject: "company", priority: 1, autoConfirm: true, action: "check_in", why: "A leadership change often starts a search" },
  company_pe_transaction: { subject: "company", priority: 1, autoConfirm: true, action: "check_in", why: "New owners review leadership in the first year" },
  company_mna: { subject: "company", priority: 1, autoConfirm: true, action: "check_in", why: "Integration reshuffles leadership" },
  company_funding_ipo: { subject: "company", priority: 1, autoConfirm: true, action: "check_in", why: "New money comes with hiring targets" },
  person_promotion: { subject: "person", priority: 2, autoConfirm: false, action: "congratulate", why: "A larger remit often means new hires" },
  person_speaking: { subject: "person", priority: 2, autoConfirm: false, action: "invite_event", why: "A meeting point and a topic to reference" },
  person_email_bounced: { subject: "person", priority: 2, autoConfirm: null, action: "check_in", why: "A bounce often means a move" },
  company_layoffs: { subject: "company", priority: 2, autoConfirm: false, action: "pause", why: "Change the angle or wait" },
  company_expansion: { subject: "company", priority: 2, autoConfirm: false, action: "check_in", why: "New territory needs new leaders" },
  company_hiring_surge: { subject: "company", priority: 2, autoConfirm: false, action: "check_in", why: "Investment in a function" },
  internal_relationship_quiet: { subject: "person", priority: 2, autoConfirm: null, action: "reengage", why: "A warm relationship is cooling" },
  person_award: { subject: "person", priority: 3, autoConfirm: false, action: "congratulate", why: "A low-pressure reason to get in touch" },
  person_content_engagement: { subject: "person", priority: 3, autoConfirm: null, action: "share_content", why: "Shows current priorities" },
  company_ceo_tenure_threshold: { subject: "company", priority: 3, autoConfirm: null, action: "share_content", why: "Long tenure often precedes a leadership review" },
  company_product_partnership: { subject: "company", priority: 3, autoConfirm: false, action: null, why: "Context for a relevant note" },
  company_intent_spike: { subject: "company", priority: 3, autoConfirm: null, action: "share_content", why: "Research activity worth a timely touch" },
  other: { subject: "either", priority: 3, autoConfirm: false, action: null, why: "Set by the validator" },
};

/** Signals about a person changing seats (BRD 7.3): these become priority 1 for placed executives. */
export const MOVEMENT_TYPES: SignalType[] = ["person_move_announced", "person_left", "person_joined", "person_board_change", "person_promotion"];

// ---------------------------------------------------------------------------------------------
// Confidence (BRD 9.4)
// ---------------------------------------------------------------------------------------------

export interface SourceFacts {
  rawItemId: string | null;
  sourceType: string;
  url: string | null;
  /** The link's host, when known; a release on the company's own domain is primary. */
  linkHost?: string | null;
  /** The extraction quoted the source verbatim. Without a quote, AI inference is low (BRD 9.4). */
  quoted: boolean;
}

export interface ConfidenceContext {
  companyDomain: string | null;
  reputableOutlets: string[];
}

export type SourceStrength = { level: Confidence; primary: boolean; reason: string };

const hostOf = (url: string | null | undefined) => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

const onDomain = (host: string | null, domain: string | null) => !!host && !!domain && (host === domain || host.endsWith(`.${domain}`));

export function sourceStrength(s: SourceFacts, ctx: ConfidenceContext): SourceStrength {
  const host = s.linkHost ?? hostOf(s.url);
  const reputable = !!host && ctx.reputableOutlets.some((o) => onDomain(host, o.toLowerCase().replace(/^www\./, "")));
  if (!s.quoted && s.sourceType !== "apollo" && s.sourceType !== "manual") return { level: "low", primary: false, reason: "AI inference without a quoted source" };
  switch (s.sourceType) {
    case "sec_8k":
      return { level: "high", primary: true, reason: "SEC filing" };
    case "leadership_page":
      return { level: "high", primary: true, reason: "The company's leadership page" };
    case "press_wire":
      if (onDomain(host, ctx.companyDomain)) return { level: "high", primary: true, reason: "Released on the company's own domain" };
      return { level: "medium", primary: false, reason: "Press release wire" };
    case "event_site":
      return { level: "medium", primary: false, reason: "Event website" };
    case "apollo":
      return { level: "medium", primary: false, reason: "Apollo data" };
    case "manual":
      return { level: "medium", primary: false, reason: "Manual entry with a source note" };
    default:
      // Google Alerts, AI research, news: medium only from an outlet on the reputable list.
      return reputable ? { level: "medium", primary: false, reason: "Reputable news outlet" } : { level: "low", primary: false, reason: "Aggregator or unverified outlet" };
  }
}

export interface ConfidenceResult {
  confidence: Confidence;
  /** High because of a primary source: a condition of the auto-confirm lane (BRD 10.1). */
  primary: boolean;
  reason: string;
}

/**
 * High: a primary source, or two independent sources of medium confidence for the same event.
 * Sources are independent when they are different documents (different addresses).
 */
export function combineConfidence(sources: SourceFacts[], ctx: ConfidenceContext): ConfidenceResult {
  const strengths = sources.map((s) => ({ s, ...sourceStrength(s, ctx) }));
  const primary = strengths.find((x) => x.primary);
  if (primary) return { confidence: "high", primary: true, reason: primary.reason };
  const mediumDocs = new Set(strengths.filter((x) => x.level !== "low").map((x, i) => x.s.url ?? x.s.rawItemId ?? `source-${i}`));
  if (mediumDocs.size >= 2) return { confidence: "high", primary: false, reason: `${mediumDocs.size} independent sources of medium confidence` };
  if (mediumDocs.size === 1) return { confidence: "medium", primary: false, reason: strengths.find((x) => x.level === "medium")!.reason };
  return { confidence: "low", primary: false, reason: strengths[0]?.reason ?? "No source" };
}

// ---------------------------------------------------------------------------------------------
// Dedupe (BRD 9.5)
// ---------------------------------------------------------------------------------------------

export function eventDateOf(s: { eventOn?: string | null; announcedOn?: string | null; foundAt: Date }): string {
  return s.eventOn ?? s.announcedOn ?? s.foundAt.toISOString().slice(0, 10);
}

export function dedupeKey(subjectId: string, type: string, eventDate: string): string {
  return `${subjectId}:${type}:${isoWeek(eventDate)}`;
}

export function withinDays(a: string, b: string, days: number): boolean {
  return Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) <= days * 86_400_000;
}

// ---------------------------------------------------------------------------------------------
// Priority (BRD 9.3 and 7.3)
// ---------------------------------------------------------------------------------------------

export interface PriorityFacts {
  type: SignalType;
  personIsPlaced: boolean;
  /** The move is to a company outside the target list. */
  offList: boolean;
}

export function priorityOf(f: PriorityFacts): { priority: 1 | 2 | 3; reason: string } {
  const base = SIGNAL_RULES[f.type].priority;
  if (f.personIsPlaced && MOVEMENT_TYPES.includes(f.type)) return { priority: 1, reason: "A placed executive: every move is priority 1" };
  if (f.offList && MOVEMENT_TYPES.includes(f.type) && base < 2) return { priority: 2, reason: "A move to a company outside the target list" };
  return { priority: base, reason: `Default for ${f.type.replace(/_/g, " ")}` };
}

// ---------------------------------------------------------------------------------------------
// Lanes (BRD 10.1), applied in order
// ---------------------------------------------------------------------------------------------

export interface LaneFacts {
  type: SignalType;
  priority: 1 | 2 | 3;
  confidence: ConfidenceResult;
  matchScore: number;
  /** A person matched by steps 1 to 3 of BRD 7.2, or a company matched by domain or CIK. */
  strongMatch: boolean;
  /** Auto-confirm is suspended this week for every source type of this signal. */
  sourceSuspended: boolean;
  batchP3: boolean;
}

export const AUTO_CONFIRM_MATCH_SCORE = 0.9;

export function laneOf(f: LaneFacts): { lane: Lane; reason: string } {
  const eligible = SIGNAL_RULES[f.type].autoConfirm === true;
  if (eligible && f.confidence.confidence === "high" && f.confidence.primary && f.matchScore >= AUTO_CONFIRM_MATCH_SCORE && f.strongMatch && !f.sourceSuspended) {
    return { lane: "auto_confirm", reason: `Primary source (${f.confidence.reason}), match ${f.matchScore.toFixed(2)}` };
  }
  if (f.priority <= 2) {
    const why = !eligible ? "type needs review" : f.sourceSuspended ? "auto-confirm is suspended for this source" : !f.confidence.primary ? "no primary source" : f.matchScore < AUTO_CONFIRM_MATCH_SCORE ? `match ${f.matchScore.toFixed(2)} is below ${AUTO_CONFIRM_MATCH_SCORE}` : "the match is not strong enough";
    return { lane: "review", reason: `Priority ${f.priority}: ${why}` };
  }
  if (f.batchP3 && f.confidence.confidence !== "low") return { lane: "weekly_batch", reason: "Priority 3 with medium or high confidence" };
  return { lane: "review", reason: "Priority 3 with low confidence" };
}
