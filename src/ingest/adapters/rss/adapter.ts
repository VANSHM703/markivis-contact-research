/**
 * Press release wires (BRD 8.3) and Google Alerts (BRD 8.4): RSS or Atom feeds configured per
 * workspace in feeds.config = { urls: string[], keywords?: string[], terms_url?: string }.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { readFixture } from "../../fixtures";
import { excerpt } from "../../html";
import { assertOk, HttpError, mockHttp, ok, type HttpClient } from "../../http";
import type { Feed, HealthResult, RawItemInput, SourceAdapter, WorkspaceCtx } from "../../types";
import { FeedParseError, fixtureNameForUrl, parseFeed } from "./parse";

export const rssFeedConfig = z.object({
  urls: z.array(z.string().url()).default([]),
  keywords: z.array(z.string()).default([]),
  terms_url: z.string().url().optional(),
});

/** Wire terms vary; store only title, link, date and an excerpt of at most 2,000 characters (BRD 8.3). */
export const WIRE_EXCERPT_CHARS = 2_000;

interface RssOptions {
  key: "press_wire" | "google_alert";
  label: string;
  excerptChars: number;
}

export function createRssAdapter(http: HttpClient, options: RssOptions): SourceAdapter {
  const fetchFeed = async (url: string) => {
    const response = await http.request({ method: "GET", url, headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
    assertOk(response, `The feed at ${new URL(url).host}`);
    return parseFeed(response.text);
  };

  return {
    key: options.key,
    async *fetch(_ctx: WorkspaceCtx, feed: Feed): AsyncIterable<RawItemInput> {
      const config = rssFeedConfig.parse(feed.config ?? {});
      const keywords = config.keywords.map((k) => k.toLowerCase()).filter(Boolean);
      for (const url of config.urls) {
        for (const entry of await fetchFeed(url)) {
          const text = `${entry.title}\n${entry.summary}`.toLowerCase();
          if (keywords.length > 0 && !keywords.some((k) => text.includes(k))) continue;
          const id = createHash("sha256").update(`${url}|${entry.id}`).digest("hex").slice(0, 32);
          yield {
            externalId: `${options.key}:${id}`,
            url: entry.link,
            title: entry.title,
            bodyText: excerpt(entry.summary, options.excerptChars),
            publishedAt: entry.published,
            payload: { feed_url: url, entry_id: entry.id, link_host: entry.link ? safeHost(entry.link) : null, terms_url: config.terms_url ?? null },
          };
        }
      }
    },
    async healthCheck(_ctx, feed): Promise<HealthResult> {
      const parsed = rssFeedConfig.safeParse(feed.config ?? {});
      if (!parsed.success || parsed.data.urls.length === 0) return { ok: false, message: `Add at least one ${options.label} feed address.` };
      try {
        const counts = [];
        for (const url of parsed.data.urls) counts.push((await fetchFeed(url)).length);
        return { ok: true, message: `${counts.length} ${counts.length === 1 ? "feed" : "feeds"} reachable, ${counts.reduce((a, b) => a + b, 0)} items available.` };
      } catch (error) {
        if (error instanceof HttpError) return { ok: false, message: error.message, detail: error.detail };
        if (error instanceof FeedParseError) return { ok: false, message: "A feed address does not return a valid feed.", detail: error.message };
        throw error;
      }
    },
  };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Mock transport: each feed URL maps to fixtures/<dir>/<url as file name>.xml. */
export function rssFixtureHttp(dir: "wires" | "alerts", now: () => Date): HttpClient {
  return mockHttp(async (req) => {
    const text = await readFixture(`${dir}/${fixtureNameForUrl(req.url)}`, now());
    return text === undefined ? undefined : ok(text, "application/rss+xml");
  });
}
