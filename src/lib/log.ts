/** Structured JSON logs with request and job IDs (BRD 19). One line per event on stdout. */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;

function emit(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (ORDER[level] < threshold || process.env.VITEST) return;
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), level, event, ...fields })}\n`);
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => emit("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};
