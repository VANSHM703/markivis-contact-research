/**
 * Per-token prices for cost logging (BRD 17.2, 19 cost control), USD per million tokens, from the
 * Anthropic model table as of 2026-09-25. Update when prices change; unknown models log no cost.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

/** Web search is billed per search; an estimate until the price table is confirmed for the account. */
export const WEB_SEARCH_USD_PER_REQUEST = 0.01;

export function costUsd(model: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }, webSearches = 0): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const cachedRead = usage.cache_read_input_tokens ?? 0;
  const cachedWrite = usage.cache_creation_input_tokens ?? 0;
  const input = usage.input_tokens * price.input + cachedRead * price.input * 0.1 + cachedWrite * price.input * 1.25;
  return Math.round(((input + usage.output_tokens * price.output) / 1_000_000 + webSearches * WEB_SEARCH_USD_PER_REQUEST) * 10_000) / 10_000;
}
