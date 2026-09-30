/** Prompt contracts (BRD 17.3): versioned prompts and the Zod schemas every AI output is validated against. */
import { z } from "zod";

export const PROMPT_VERSION_EXTRACT = "extract.v1";
export const PROMPT_VERSION_DRAFT = "draft.v2";
export const PROMPT_VERSION_RESEARCH = "research.v1";

export const SIGNAL_TYPES = [
  "person_move_announced", "person_left", "person_joined", "person_board_change", "company_cxo_change",
  "company_pe_transaction", "company_mna", "company_funding_ipo", "person_promotion", "person_speaking",
  "person_email_bounced", "company_layoffs", "company_expansion", "company_hiring_surge",
  "internal_relationship_quiet", "person_award", "person_content_engagement", "company_ceo_tenure_threshold",
  "company_product_partnership", "company_intent_spike", "other",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

/** Types the extraction model may choose. Rule-driven types are raised by the pipeline itself. */
export const EXTRACTABLE_TYPES = SIGNAL_TYPES.filter(
  (t) => !["internal_relationship_quiet", "person_content_engagement", "company_ceo_tenure_threshold", "company_intent_spike", "person_email_bounced"].includes(t),
) as SignalType[];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

export const extractOutputSchema = z.object({
  is_relevant: z.boolean(),
  signal_type: z.enum(SIGNAL_TYPES).nullable(),
  subject_kind: z.enum(["person", "company"]).nullable(),
  person_candidate_id: z.string().nullable(),
  company_candidate_id: z.string().nullable(),
  match_confidence: z.number().min(0).max(1),
  new_title: z.string().nullable(),
  previous_title: z.string().nullable(),
  event_date: isoDate,
  announced_date: isoDate,
  effective_date: isoDate,
  headline: z.string(),
  evidence_quote: z.string(),
});
export type ExtractOutput = z.infer<typeof extractOutputSchema>;

export interface Candidate {
  id: string;
  kind: "person" | "company";
  name: string;
  aliases?: string[];
  company_name?: string | null;
  title?: string | null;
}

export interface ExtractInput {
  rawItemExternalId: string;
  title: string;
  bodyText: string;
  sourceType: string;
  publishedAt: string | null;
  candidates: Candidate[];
}

export const EXTRACT_BODY_LIMIT = 12_000;

export const EXTRACT_SYSTEM = `You read news items, filings and web page changes for an executive search firm and report changes about senior decision-makers.

Rules:
- Classify only into the listed signal types. If the text does not clearly describe a change about one of the candidates, return is_relevant: false.
- You may only choose person_candidate_id and company_candidate_id from the candidate list, by their id. Never invent an id.
- evidence_quote must be copied verbatim from the input text, at most 300 characters.
- Never infer a person's employer or title that the text does not state.
- headline: one factual sentence, at most 140 characters, no speculation.
- Dates are YYYY-MM-DD or null. event_date is when the change happened or was decided; effective_date is when it takes effect.
- match_confidence is how sure you are that the candidate you chose is the person or company the text is about, from 0 to 1.`;

export const draftOutputSchema = z.object({
  subject: z.string().nullable(),
  body: z.string(),
  used_content_item: z.boolean(),
  rationale: z.string(),
});
export type DraftOutput = z.infer<typeof draftOutputSchema>;

export interface DraftInput {
  partnerName: string;
  styleGuide: string;
  person: { preferredName: string; fullName: string; role: string | null; company: string | null; contactTypes: string[]; country: string | null };
  signal: { headline: string; type: string; eventOn: string | null; effectiveOn: string | null; sourceTitle: string | null } | null;
  suggestedAction: string;
  bestPath: { kind: string; connectorName?: string; explanation: string } | null;
  recentInteractions: { channel: string; date: string; direction: string; subject?: string | null }[];
  band: string | null;
  contentItem: { title: string; description: string | null; url: string | null } | null;
  channel: "email" | "linkedin_message";
  /**
   * Executive search pack (BRD 13): a client message discusses the company's leadership needs, a
   * candidate message (only on explicit request) the person's career. Null when the pack is off.
   */
  approach: "client" | "candidate" | null;
  instruction?: string | null;
}

export const DRAFT_SYSTEM = `You draft short outreach messages for a partner at an executive search firm, written as the partner.

Rules:
- Follow the style guide exactly.
- One clear, low-pressure ask.
- State only facts present in the context. Never claim a shared history that is not in the interactions listed.
- Never mention how the change was detected.
- For an introduction request, write to the connector, not the target.
- approach "client": write about the company's leadership needs and how the partner can help; never raise the person's own next career move.
- approach "candidate": write about the person's own career and a possible opportunity; never pitch the firm's services to them. Never mix the two approaches in one message.
- rationale: one sentence for the approver saying why this angle.`;

export const researchOutputSchema = z.object({
  verdict: z.enum(["confirms", "contradicts", "inconclusive"]),
  sources: z.array(z.object({ url: z.string(), title: z.string(), published_date: isoDate, supports: z.boolean() })).max(3),
  note: z.string(),
});
export type ResearchOutput = z.infer<typeof researchOutputSchema>;

export interface ResearchInput {
  signalId: string;
  signalType: string;
  headline: string;
  eventOn: string | null;
  sources: { url: string | null; title: string | null; publishedAt: string | null }[];
}

export const RESEARCH_SYSTEM = `You check a reported leadership change for a research validator.

Search the web for up to three independent sources, published within 30 days of the event, that confirm or contradict the claim. Report them with the report_research tool: verdict, sources (url, title, published date, whether each supports the claim) and one sentence for the validator. Never confirm on your own judgement: if the sources do not settle it, the verdict is inconclusive.`;

// ---------------------------------------------------------------------------------------------
// meeting_brief (BRD 12.6, 17.3): seven sections, each at most 80 words
// ---------------------------------------------------------------------------------------------

export const PROMPT_VERSION_BRIEF = "brief.v1";

export const BRIEF_HEADINGS = ["Who they are", "What changed recently", "Our history", "What they care about", "Mutual connections", "Open items", "Suggested talking points"] as const;
export const NOTHING_ON_RECORD = "Nothing on record.";
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const section = z.string().refine((s) => words(s) <= 80, "Keep each section to 80 words or fewer.");

export const briefOutputSchema = z.object({
  who_they_are: section,
  what_changed_recently: section,
  our_history: section,
  what_they_care_about: section,
  mutual_connections: section,
  open_items: section,
  suggested_talking_points: z.array(z.string()).length(3, "Give exactly three talking points.").refine((xs) => words(xs.join(" ")) <= 80, "Keep the talking points to 80 words or fewer."),
});
export type BriefOutput = z.infer<typeof briefOutputSchema>;

export interface BriefInput {
  person: { fullName: string; role: string | null; company: string | null; country: string | null };
  roles: { title: string; company: string; from: string | null; to: string | null; status: string }[];
  signals: { headline: string; date: string | null; about: "person" | "company" }[];
  /** Metadata only; private subjects are removed before this is built. */
  interactions: { channel: string; date: string; direction: string; subject: string | null }[];
  relationship: { band: string; score: number; factors: string[] } | null;
  paths: { explanation: string }[];
  interests: { topic: string; source: string }[];
  contentSent: { title: string; date: string }[];
  openActions: { type: string; headline: string | null; due: string }[];
  meeting: { title: string | null; startsAt: string } | null;
}

export const BRIEF_SYSTEM = `You write a one-page meeting brief for a partner at an executive search firm.

Rules:
- Use only the facts in the context. Never invent history, titles, dates or names.
- Each section is at most 80 words, plain sentences, no headings inside.
- When the context has nothing for a section, write exactly "${NOTHING_ON_RECORD}"
- Suggested talking points: exactly three short points grounded in the context.
- Never mention how information was detected or collected.`;

/** The brief as markdown with exactly the seven headings (BRD 17.3). */
export function briefMarkdown(out: BriefOutput): string {
  const body = [out.who_they_are, out.what_changed_recently, out.our_history, out.what_they_care_about, out.mutual_connections, out.open_items];
  const parts = BRIEF_HEADINGS.slice(0, 6).map((h, i) => `## ${h}\n\n${body[i]!.trim() || NOTHING_ON_RECORD}`);
  const points = out.suggested_talking_points.filter((p) => p.trim());
  parts.push(`## ${BRIEF_HEADINGS[6]}\n\n${points.length ? points.map((p) => `- ${p.trim()}`).join("\n") : NOTHING_ON_RECORD}`);
  return parts.join("\n\n");
}
