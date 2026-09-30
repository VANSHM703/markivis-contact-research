/**
 * Live AiAdapter on the Anthropic Messages API (BRD 17). API shapes follow the claude-api skill
 * for @anthropic-ai/sdk 0.129 (read 2026-09-30):
 *
 * - Structured JSON comes from structured outputs (`output_config.format` via `messages.parse`
 *   with a Zod schema), not forced tool use, which Claude Sonnet 5.5 rejects.
 * - Claude Sonnet 5.5 rejects non-default sampling, so drafts run without the temperature BRD
 *   17.3 proposes; effort is set instead. Extraction on Claude Haiku 4.5 keeps temperature 0.
 * - Sonnet calls opt into the server-side refusal fallback (`fallbacks: "default"`, beta
 *   `server-side-fallback-2026-07-01`). A refusal that survives it is an AiOutputError, and the
 *   item goes to a person.
 * - Research uses the web search server tool (`web_search_20260209`) plus a strict reporting
 *   tool, with `tool_choice: auto` and a check that the report was made; `pause_turn` is resumed.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { AiOutputError, MODELS, type AiAdapter, type AiCallRecord, type AiResult } from "./adapter";
import {
  DRAFT_SYSTEM, draftOutputSchema, EXTRACT_BODY_LIMIT, EXTRACT_SYSTEM, extractOutputSchema, PROMPT_VERSION_DRAFT, PROMPT_VERSION_EXTRACT,
  PROMPT_VERSION_RESEARCH, RESEARCH_SYSTEM, researchOutputSchema, EXTRACTABLE_TYPES,
  type DraftInput, type ExtractInput,
} from "./contracts";
import { costUsd } from "./pricing";

const FALLBACK_BETA = "server-side-fallback-2026-07-01" as const;

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; server_tool_use?: { web_search_requests?: number } | null };

function record(purpose: AiCallRecord["purpose"], model: string, promptVersion: string, started: number, usage: Usage[], status: "ok" | "error", error?: string): AiCallRecord {
  type Sum = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; searches: number };
  const sum = usage.reduce<Sum>(
    (a, u) => ({
      input_tokens: a.input_tokens + u.input_tokens,
      output_tokens: a.output_tokens + u.output_tokens,
      cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      searches: a.searches + (u.server_tool_use?.web_search_requests ?? 0),
    }),
    { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, searches: 0 },
  );
  return {
    purpose,
    model,
    promptVersion,
    inputTokens: usage.length ? sum.input_tokens : null,
    outputTokens: usage.length ? sum.output_tokens : null,
    costUsd: usage.length ? costUsd(model, sum, sum.searches) : null,
    latencyMs: Date.now() - started,
    status,
    error,
  };
}

function extractPrompt(input: ExtractInput): string {
  return [
    `Source type: ${input.sourceType}`,
    `Published: ${input.publishedAt ?? "unknown"}`,
    `Signal types you may use: ${EXTRACTABLE_TYPES.join(", ")}`,
    `Candidates (choose ids only from this list):\n${JSON.stringify(input.candidates)}`,
    `Title: ${input.title}`,
    `Text:\n${input.bodyText.slice(0, EXTRACT_BODY_LIMIT)}`,
  ].join("\n\n");
}

function draftPrompt(input: DraftInput): string {
  return `Style guide:\n${input.styleGuide}\n\nContext (use only these facts):\n${JSON.stringify({ ...input, styleGuide: undefined }, null, 2)}\n\nWrite the ${input.channel === "email" ? "email (subject and body)" : "LinkedIn message (subject null)"}.`;
}

export function createLiveAi(client = new Anthropic()): AiAdapter {
  /**
   * One structured call with a single retry that includes the validation error (BRD 17.1).
   * `run` performs the request for the given message list and returns the parsed value and usage.
   */
  async function structured<T>(
    purpose: AiCallRecord["purpose"],
    model: string,
    promptVersion: string,
    schema: z.ZodType<T>,
    firstMessage: string,
    run: (messages: Anthropic.MessageParam[]) => Promise<{ parsed: unknown; text: string; usage: Usage; stopReason: string | null }>,
  ): Promise<AiResult<T>> {
    const started = Date.now();
    const usages: Usage[] = [];
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: firstMessage }];
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      let result;
      try {
        result = await run(messages);
      } catch (error) {
        const message = error instanceof Anthropic.APIError ? `API error ${error.status}: ${error.message}` : (error as Error).message;
        throw new AiOutputError(message, record(purpose, model, promptVersion, started, usages, "error", message));
      }
      usages.push(result.usage);
      if (result.stopReason === "refusal") {
        throw new AiOutputError("The model declined this item.", record(purpose, model, promptVersion, started, usages, "error", "refusal"));
      }
      const checked = schema.safeParse(result.parsed);
      if (checked.success) return { output: checked.data, call: record(purpose, model, promptVersion, started, usages, "ok") };
      lastError = checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      messages.push({ role: "assistant", content: result.text || "{}" }, { role: "user", content: `That output failed validation: ${lastError}. Return corrected output that matches the schema exactly.` });
    }
    throw new AiOutputError("AI could not read this item", record(purpose, model, promptVersion, started, usages, "error", lastError));
  }

  const textOf = (content: { type: string; text?: string }[]) => content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");

  return {
    mode: "live",

    async extractSignal(input) {
      const model = MODELS.fast();
      return structured("extract_signal", model, PROMPT_VERSION_EXTRACT, extractOutputSchema, extractPrompt(input), async (messages) => {
        const response = await client.messages.parse({
          model,
          max_tokens: 2_000,
          temperature: 0,
          system: EXTRACT_SYSTEM,
          messages,
          output_config: { format: zodOutputFormat(extractOutputSchema) },
        });
        return { parsed: response.parsed_output, text: textOf(response.content), usage: response.usage, stopReason: response.stop_reason };
      });
    },

    async draftMessage(input) {
      const model = MODELS.write();
      return structured("draft_message", model, PROMPT_VERSION_DRAFT, draftOutputSchema, draftPrompt(input), async (messages) => {
        const response = await client.beta.messages.parse({
          model,
          max_tokens: 8_000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          system: DRAFT_SYSTEM,
          messages,
          output_config: { effort: "medium", format: betaZodOutputFormat(draftOutputSchema) },
        });
        return { parsed: response.parsed_output, text: textOf(response.content), usage: response.usage, stopReason: response.stop_reason };
      });
    },

    async researchMore(input) {
      const model = MODELS.write();
      const started = Date.now();
      const usages: Usage[] = [];
      const reportTool: Anthropic.Beta.BetaTool = {
        name: "report_research",
        description: "Report what the search found. Call exactly once, when you are done searching.",
        strict: true,
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["verdict", "sources", "note"],
          properties: {
            verdict: { type: "string", enum: ["confirms", "contradicts", "inconclusive"] },
            sources: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["url", "title", "published_date", "supports"],
                properties: { url: { type: "string" }, title: { type: "string" }, published_date: { type: ["string", "null"] }, supports: { type: "boolean" } },
              },
            },
            note: { type: "string" },
          },
        },
      };
      const messages: Anthropic.Beta.BetaMessageParam[] = [
        { role: "user", content: `Claim to check:\n${JSON.stringify({ type: input.signalType, headline: input.headline, event_date: input.eventOn, sources_so_far: input.sources }, null, 2)}` },
      ];
      for (let turn = 0; turn < 5; turn++) {
        let response;
        try {
          response = await client.beta.messages.create({
            model,
            max_tokens: 16_000,
            betas: [FALLBACK_BETA],
            fallbacks: "default",
            system: RESEARCH_SYSTEM,
            messages,
            tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }, reportTool],
            tool_choice: { type: "auto" },
            output_config: { effort: "medium" },
          });
        } catch (error) {
          const message = error instanceof Anthropic.APIError ? `API error ${error.status}: ${error.message}` : (error as Error).message;
          throw new AiOutputError(message, record("research_more", model, PROMPT_VERSION_RESEARCH, started, usages, "error", message));
        }
        usages.push(response.usage as Usage);
        if (response.stop_reason === "refusal") throw new AiOutputError("The model declined this research.", record("research_more", model, PROMPT_VERSION_RESEARCH, started, usages, "error", "refusal"));
        const report = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "report_research");
        if (report) {
          const checked = researchOutputSchema.safeParse(report.input);
          if (checked.success) return { output: checked.data, call: record("research_more", model, PROMPT_VERSION_RESEARCH, started, usages, "ok") };
          throw new AiOutputError("AI could not read this item", record("research_more", model, PROMPT_VERSION_RESEARCH, started, usages, "error", checked.error.message));
        }
        // A paused server-tool turn is resumed by sending the assistant turn back; otherwise ask for the report.
        messages.push({ role: "assistant", content: response.content });
        if (response.stop_reason !== "pause_turn") messages.push({ role: "user", content: "Report your findings now with the report_research tool." });
      }
      throw new AiOutputError("Research did not finish.", record("research_more", model, PROMPT_VERSION_RESEARCH, started, usages, "error", "no report"));
    },
  };
}
