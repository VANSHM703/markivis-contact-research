/**
 * Mock AiAdapter (BRD 17.4). Extraction reads fixtures/ai/extract/<raw item external id>.json,
 * naming people and companies by name, which are mapped to the supplied candidate IDs. Drafts
 * render from a template, prefixed "[Mock draft]". Research returns a fixed, fictional source.
 * No network, no cost.
 */
import { readJsonFixture } from "@/ingest/fixtures";
import { normaliseCompanyName, normaliseName } from "@/lib/normalise";
import type { AiAdapter, AiCallRecord } from "./adapter";
import { NOTHING_ON_RECORD, PROMPT_VERSION_BRIEF, PROMPT_VERSION_DRAFT, PROMPT_VERSION_EXTRACT, PROMPT_VERSION_RESEARCH, type ExtractOutput } from "./contracts";

interface ExtractFixture extends Omit<ExtractOutput, "person_candidate_id" | "company_candidate_id"> {
  person_name: string | null;
  company_name: string | null;
}

export const fixtureFileForExternalId = (externalId: string) => `ai/extract/${externalId.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;

const call = (purpose: AiCallRecord["purpose"], promptVersion: string): AiCallRecord => ({ purpose, model: "mock", promptVersion, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, status: "ok" });

const IRRELEVANT: ExtractOutput = {
  is_relevant: false, signal_type: null, subject_kind: null, person_candidate_id: null, company_candidate_id: null, match_confidence: 0,
  new_title: null, previous_title: null, event_date: null, announced_date: null, effective_date: null, headline: "", evidence_quote: "",
};

export function createMockAi(now: () => Date): AiAdapter {
  return {
    mode: "mock",

    async extractSignal(input) {
      const fixture = await readJsonFixture<ExtractFixture>(fixtureFileForExternalId(input.rawItemExternalId), now());
      if (!fixture || !fixture.is_relevant) return { output: IRRELEVANT, call: call("extract_signal", PROMPT_VERSION_EXTRACT) };
      const person = fixture.person_name ? input.candidates.find((c) => c.kind === "person" && normaliseName(c.name) === normaliseName(fixture.person_name!)) : undefined;
      const company = fixture.company_name ? input.candidates.find((c) => c.kind === "company" && normaliseCompanyName(c.name) === normaliseCompanyName(fixture.company_name!)) : undefined;
      const { person_name: _p, company_name: _c, ...rest } = fixture;
      return { output: { ...rest, person_candidate_id: person?.id ?? null, company_candidate_id: company?.id ?? null }, call: call("extract_signal", PROMPT_VERSION_EXTRACT) };
    },

    async draftMessage(input) {
      const first = input.partnerName.split(" ")[0] ?? input.partnerName;
      const reason = input.signal ? `I saw the news: ${input.signal.headline.replace(/\.$/, "")}.` : "It has been a while since we last spoke.";
      const ask =
        input.approach === "candidate"
          ? "I am working on a search you may find worth hearing about for your own next step. Would you be open to a confidential conversation?"
          : input.suggestedAction === "congratulate"
            ? "Congratulations. If it would be useful, I would be glad to compare notes on the leadership team as you settle in."
            : "Would you have time in the next few weeks for a short call about your leadership team?";
      const content = input.contentItem ? ` You may find our recent piece, "${input.contentItem.title}", relevant.` : "";
      const body = `[Mock draft] Dear ${input.person.preferredName},\n\n${reason}${content} ${ask}\n\nBest regards,\n${first}`;
      return {
        output: { subject: input.channel === "email" ? (input.signal ? `Congratulations` : "Catching up") : null, body, used_content_item: !!input.contentItem, rationale: "Mock mode: a template, not a model." },
        call: call("draft_message", PROMPT_VERSION_DRAFT),
      };
    },

    async meetingBrief(input) {
      const first = input.person.fullName.split(" ")[0];
      const or = (s: string | null | undefined) => (s && s.trim() ? s : NOTHING_ON_RECORD);
      const role = input.person.role ? `${input.person.role}${input.person.company ? ` at ${input.person.company}` : ""}` : null;
      const last = input.interactions[0];
      return {
        output: {
          who_they_are: or(role ? `[Mock brief] ${input.person.fullName}, ${role}.${input.roles.length > 1 ? ` Before that: ${input.roles.slice(1, 3).map((r) => `${r.title}, ${r.company}`).join("; ")}.` : ""}` : null),
          what_changed_recently: or(input.signals.slice(0, 2).map((s) => s.headline).join(". ")),
          our_history: or(last ? `${input.interactions.length} interactions on record; the latest was a ${last.channel.replace("_", " ")} on ${last.date}.${input.relationship ? ` Relationship: ${input.relationship.band}, ${input.relationship.score} / 100.` : ""}` : null),
          what_they_care_about: or(input.interests.map((i) => i.topic).join(", ")),
          mutual_connections: or(input.paths[0]?.explanation),
          open_items: or(input.openActions.map((a) => a.headline ?? a.type).join("; ")),
          suggested_talking_points: [
            input.signals[0] ? `Ask ${first} how the change is landing: ${input.signals[0].headline}.` : `Ask ${first} what is on the leadership agenda this quarter.`,
            input.interests[0] ? `Share a view on ${input.interests[0].topic.toLowerCase()}.` : "Ask what would make the next year a success.",
            "Agree a clear next step before the meeting ends.",
          ],
        },
        call: call("meeting_brief", PROMPT_VERSION_BRIEF),
      };
    },

    async researchMore(input) {
      return {
        output: {
          verdict: "confirms",
          sources: [{ url: `https://news.example.net/research/${input.signalId.slice(0, 8)}`, title: `Report confirming: ${input.headline}`.slice(0, 200), published_date: input.eventOn, supports: true }],
          note: "Mock research: one fictional source that supports the claim.",
        },
        call: call("research_more", PROMPT_VERSION_RESEARCH),
      };
    },
  };
}
