/** The live AI adapter's control flow (BRD 17.1), against a fake SDK client: no network, no cost. */
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { AiOutputError } from "@/ai/adapter";
import { createLiveAi } from "@/ai/live";

const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const good = { is_relevant: true, signal_type: "person_left", subject_kind: "person", person_candidate_id: "p1", company_candidate_id: "c1", match_confidence: 0.95, new_title: null, previous_title: "CFO", event_date: "2026-09-28", announced_date: null, effective_date: null, headline: "Jane resigns", evidence_quote: "Jane resigned." };
const input = { rawItemExternalId: "sec:1", title: "8-K", bodyText: "Jane resigned.", sourceType: "sec_8k", publishedAt: null, candidates: [] };

function fakeClient(responses: unknown[]) {
  const parse = vi.fn(async () => responses.shift());
  return { client: { messages: { parse }, beta: { messages: { parse, create: vi.fn(async () => responses.shift()) } } } as unknown as Anthropic, parse };
}

describe("live AI adapter", () => {
  it("returns validated output and logs tokens and cost at the model's price", async () => {
    const { client, parse } = fakeClient([{ parsed_output: good, content: [], usage, stop_reason: "end_turn" }]);
    const result = await createLiveAi(client).extractSignal(input);
    expect(result.output.signal_type).toBe("person_left");
    expect(result.call).toMatchObject({ purpose: "extract_signal", model: "claude-haiku-4-5-20251001", inputTokens: 1000, outputTokens: 200, status: "ok" });
    // Claude Haiku 4.5: $1 in, $5 out per million tokens.
    expect(result.call.costUsd).toBe(0.002);
    const args = (parse.mock.calls[0] as unknown[])[0] as { temperature: number; output_config: { format: unknown } };
    expect(args.temperature).toBe(0);
    expect(args.output_config.format).toBeDefined();
  });

  it("retries once with the validation error, then gives up with 'AI could not read this item'", async () => {
    const bad = { ...good, match_confidence: 7 };
    const { client, parse } = fakeClient([
      { parsed_output: bad, content: [{ type: "text", text: "{}" }], usage, stop_reason: "end_turn" },
      { parsed_output: bad, content: [{ type: "text", text: "{}" }], usage, stop_reason: "end_turn" },
    ]);
    await expect(createLiveAi(client).extractSignal(input)).rejects.toThrow("AI could not read this item");
    expect(parse).toHaveBeenCalledTimes(2);
    const retry = (parse.mock.calls[1] as unknown[])[0] as { messages: { role: string; content: string }[] };
    expect(retry.messages.at(-1)!.content).toMatch(/failed validation: match_confidence/);
  });

  it("treats a refusal as an error for a person to handle", async () => {
    const { client } = fakeClient([{ parsed_output: null, content: [], usage, stop_reason: "refusal" }]);
    const error = await createLiveAi(client).extractSignal(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiOutputError);
    expect((error as AiOutputError).call.error).toBe("refusal");
  });

  it("drafts on the write model with the server-side refusal fallback and no sampling parameters", async () => {
    const { client, parse } = fakeClient([{ parsed_output: { subject: "Hello", body: "Dear Jane", used_content_item: false, rationale: "Timely." }, content: [], usage, stop_reason: "end_turn" }]);
    const result = await createLiveAi(client).draftMessage({
      partnerName: "Jordan Ellis", styleGuide: "Short.", person: { preferredName: "Jane", fullName: "Jane Example", role: "CFO", company: "Example", contactTypes: [], country: "US" },
      signal: null, suggestedAction: "check_in", bestPath: null, recentInteractions: [], band: null, contentItem: null, channel: "email",
    });
    expect(result.output.body).toBe("Dear Jane");
    const args = (parse.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(args).toMatchObject({ model: "claude-sonnet-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    expect(args).not.toHaveProperty("temperature");
    // Claude Sonnet 5.5: $2 in, $10 out per million tokens.
    expect(result.call.costUsd).toBe(0.004);
  });
});
