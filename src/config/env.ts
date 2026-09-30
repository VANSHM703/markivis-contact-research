export type DataMode = "live" | "mock" | "record";

const DATA_MODES: readonly DataMode[] = ["live", "mock", "record"];

type Env = Record<string, string | undefined>;

/** DATA_MODE selects every adapter's implementation (BRD section 4.1). Defaults to mock. */
export function getDataMode(env: Env = process.env): DataMode {
  const value = env.DATA_MODE?.trim().toLowerCase();
  return DATA_MODES.includes(value as DataMode) ? (value as DataMode) : "mock";
}

/**
 * True when any adapter runs on fixtures. The AI adapter falls back to mock when no
 * ANTHROPIC_API_KEY is present, even in live mode (BRD section 17.4).
 */
export function isAnyAdapterMock(env: Env = process.env): boolean {
  return getDataMode(env) === "mock" || !env.ANTHROPIC_API_KEY;
}
