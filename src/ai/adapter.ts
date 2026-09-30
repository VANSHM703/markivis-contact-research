/**
 * AiAdapter (BRD 17.1): live (Anthropic Messages API) and mock (fixtures and templates). Every
 * call is recorded in ai_calls with purpose, model, prompt version, tokens, cost and latency.
 */
import { getDataMode, type DataMode } from "@/config/env";
import type { DraftInput, DraftOutput, ExtractInput, ExtractOutput, ResearchInput, ResearchOutput } from "./contracts";

export interface AiCallRecord {
  purpose: "extract_signal" | "draft_message" | "research_more";
  model: string;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  status: "ok" | "error";
  error?: string;
}

export interface AiResult<T> {
  output: T;
  call: AiCallRecord;
}

export interface AiAdapter {
  mode: "live" | "mock";
  extractSignal(input: ExtractInput): Promise<AiResult<ExtractOutput>>;
  draftMessage(input: DraftInput): Promise<AiResult<DraftOutput>>;
  researchMore(input: ResearchInput): Promise<AiResult<ResearchOutput>>;
}

/** The AI could not produce valid output after one retry; the item goes to review (BRD 17.1). */
export class AiOutputError extends Error {
  constructor(
    message: string,
    public readonly call: AiCallRecord,
  ) {
    super(message);
  }
}

export const MODELS = {
  fast: () => process.env.AI_MODEL_FAST || "claude-haiku-4-5-20251001",
  write: () => process.env.AI_MODEL_WRITE || "claude-sonnet-5-5",
};

/** Mock whenever DATA_MODE is mock or no API key is configured (BRD 17.4). */
export function aiMode(env: NodeJS.ProcessEnv = process.env, mode: DataMode = getDataMode(env)): "live" | "mock" {
  return mode === "mock" || !env.ANTHROPIC_API_KEY ? "mock" : "live";
}

export async function getAi(mode: "live" | "mock" = aiMode(), now: () => Date = () => new Date()): Promise<AiAdapter> {
  if (mode === "mock") {
    const { createMockAi } = await import("./mock");
    return createMockAi(now);
  }
  const { createLiveAi } = await import("./live");
  return createLiveAi();
}
