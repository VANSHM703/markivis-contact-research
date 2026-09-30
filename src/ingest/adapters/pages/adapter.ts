/**
 * Company leadership and board pages (BRD 8.5). Each URL in companies.leadership_page_urls is
 * fetched weekly, robots.txt permitting, at most one request per domain per 10 seconds. The
 * visible text is compared with the previous capture; a diff that adds or removes a name or a
 * title becomes a raw item with both the added and removed lines.
 */
import robotsParser from "robots-parser";
import { sql } from "drizzle-orm";
import { companies } from "@/db/schema";
import { readFixture } from "../../fixtures";
import { htmlToLines } from "../../html";
import { assertOk, HttpError, mockHttp, ok, type HttpClient } from "../../http";
import type { Feed, HealthResult, RawItemInput, SourceAdapter, WorkspaceCtx } from "../../types";
import { latestRawItem } from "../../write";
import { diffLines, hashText } from "./diff";

/** The product token robots.txt rules are matched against. */
export const ROBOTS_AGENT = "BEAMIntelligence";
export const PAGES_USER_AGENT = `${ROBOTS_AGENT}/1.0 (+https://beam.markivis.com/intelligence)`;
/** Header that tells the mock transport which capture it is diffing against. Never sent live. */
export const MOCK_PREVIOUS_HEADER = "x-dmi-previous-snapshot";

interface Snapshot {
  kind: "snapshot" | "diff";
  url: string;
  company_id: string;
  hash: string;
  lines: string[];
}

export function createPagesAdapter(http: HttpClient, options: { jitter?: (companyIndex: number) => Promise<void> } = {}): SourceAdapter {
  const robotsCache = new Map<string, ReturnType<typeof robotsParser> | null>();

  async function allowed(url: string): Promise<boolean> {
    const origin = new URL(url).origin;
    if (!robotsCache.has(origin)) {
      const robotsUrl = `${origin}/robots.txt`;
      const response = await http.request({ method: "GET", url: robotsUrl });
      // No robots.txt (4xx) means everything is allowed; a server error means try again later.
      if (response.status >= 500) throw new HttpError(`robots.txt at ${new URL(url).host} could not be read.`, response.status);
      robotsCache.set(origin, response.status < 400 ? robotsParser(robotsUrl, response.text) : null);
    }
    const robots = robotsCache.get(origin);
    return robots ? robots.isAllowed(url, ROBOTS_AGENT) !== false : true;
  }

  return {
    key: "leadership_page",
    async *fetch(ctx: WorkspaceCtx, _feed: Feed): AsyncIterable<RawItemInput> {
      const rows = await ctx.tx
        .select({ id: companies.id, name: companies.name, urls: companies.leadershipPageUrls })
        .from(companies)
        .where(sql`cardinality(${companies.leadershipPageUrls}) > 0`);

      let index = 0;
      for (const company of rows) {
        await options.jitter?.(index++);
        for (const url of company.urls) {
          if (!(await allowed(url))) continue;
          const key = `page:${hashText(url)}:`;
          const previous = await latestRawItem(ctx, "leadership_page", key);
          const prev = previous?.payload as Snapshot | undefined;
          const headers: Record<string, string> = { accept: "text/html" };
          if (http.mode === "mock" && prev) headers[MOCK_PREVIOUS_HEADER] = prev.hash;
          const response = await http.request({ method: "GET", url, headers });
          assertOk(response, `The leadership page for ${company.name}`);
          const lines = htmlToLines(response.text);
          const hash = hashText(lines.join("\n"));
          if (prev?.hash === hash) continue;

          const base = { url, company_id: company.id, hash, lines };
          if (!prev) {
            // The first capture is the baseline: kept for the next diff, never a signal.
            yield { externalId: `${key}${hash}`, url, title: `Leadership page captured: ${company.name}`, publishedAt: ctx.now, payload: { ...base, kind: "snapshot" }, preProcessed: { outcome: "irrelevant" } };
            continue;
          }
          const diff = diffLines(prev.lines, lines);
          const significant = diff.added.length + diff.removed.length > 0;
          yield {
            externalId: `${key}${hash}`,
            url,
            title: significant ? `Leadership page changed: ${company.name}` : `Leadership page captured: ${company.name}`,
            bodyText: significant ? [diff.added.length ? `Added:\n${diff.added.join("\n")}` : "", diff.removed.length ? `Removed:\n${diff.removed.join("\n")}` : ""].filter(Boolean).join("\n\n") : null,
            publishedAt: ctx.now,
            payload: { ...base, kind: significant ? "diff" : "snapshot", added: diff.added, removed: diff.removed, previous_raw_item_id: previous!.id },
            preProcessed: significant ? undefined : { outcome: "irrelevant" },
          };
        }
      }
    },
    async healthCheck(ctx): Promise<HealthResult> {
      const [first] = await ctx.tx
        .select({ name: companies.name, urls: companies.leadershipPageUrls })
        .from(companies)
        .where(sql`cardinality(${companies.leadershipPageUrls}) > 0`)
        .limit(1);
      if (!first) return { ok: true, message: "No company has a leadership page address yet. Add one on the company's page." };
      const url = first.urls[0]!;
      try {
        if (!(await allowed(url))) return { ok: false, message: `robots.txt at ${new URL(url).host} does not allow this page to be read, so it is skipped.` };
        const response = await http.request({ method: "GET", url, headers: { accept: "text/html" } });
        assertOk(response, `The leadership page for ${first.name}`);
        return { ok: true, message: `Leadership pages reachable. ${first.name}: ${htmlToLines(response.text).length} lines of text.` };
      } catch (error) {
        if (error instanceof HttpError) return { ok: false, message: error.message, detail: error.detail };
        throw error;
      }
    },
  };
}

/**
 * Mock transport. Each page has fixtures/pages/<host><path>.before.html and .after.html. With no
 * previous capture it serves "before"; once "before" has been captured it serves "after", so a
 * second run produces the diff, and later runs see no change.
 */
export function pagesFixtureHttp(now: () => Date): HttpClient {
  return mockHttp(async (req) => {
    const url = new URL(req.url);
    const base = `pages/${url.host}${url.pathname.replace(/\/$/, "") || "/index"}`;
    if (url.pathname === "/robots.txt") {
      const robots = await readFixture(`pages/${url.host}/robots.txt`, now());
      return robots === undefined ? { status: 404, headers: {}, text: "" } : ok(robots, "text/plain");
    }
    const before = await readFixture(`${base}.before.html`, now());
    const after = await readFixture(`${base}.after.html`, now());
    if (before === undefined) return undefined;
    const previous = req.headers?.[MOCK_PREVIOUS_HEADER];
    const beforeHash = hashText(htmlToLines(before).join("\n"));
    return ok(previous && after !== undefined && previous !== undefined && (previous === beforeHash || previous === hashText(htmlToLines(after).join("\n"))) ? after : before, "text/html");
  });
}
