/**
 * Fixture files for mock mode, under /fixtures/<adapter>/ (BRD 4.1 and 21). Fixture text may
 * hold date tokens resolved against the run's clock, so the demo stays current:
 *   {{date:-3}}      the date three days ago, YYYY-MM-DD
 *   {{datetime:-3}}  the same, as an ISO timestamp at 13:30 UTC
 *   {{rfc822:-3}}    the same, in RSS pubDate format
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export const FIXTURES_ROOT = path.resolve(process.env.FIXTURES_DIR ?? "fixtures");

const DAY = 86_400_000;

export function resolveTokens(text: string, now: Date): string {
  return text.replace(/\{\{(date|datetime|rfc822):([+-]?\d+)\}\}/g, (_m, kind: string, offset: string) => {
    const d = new Date(now.getTime() + Number(offset) * DAY);
    d.setUTCHours(13, 30, 0, 0);
    if (kind === "date") return d.toISOString().slice(0, 10);
    if (kind === "datetime") return d.toISOString();
    return d.toUTCString();
  });
}

export async function readFixture(relativePath: string, now: Date): Promise<string | undefined> {
  const full = path.resolve(FIXTURES_ROOT, relativePath);
  if (!full.startsWith(FIXTURES_ROOT + path.sep)) return undefined;
  try {
    return resolveTokens(await readFile(full, "utf8"), now);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readJsonFixture<T>(relativePath: string, now: Date): Promise<T | undefined> {
  const text = await readFixture(relativePath, now);
  return text === undefined ? undefined : (JSON.parse(text) as T);
}
