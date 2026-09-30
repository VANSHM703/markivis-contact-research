/** Chooses each adapter's transport for the data mode (BRD 4.1): live, mock (fixtures) or record. */
import { getDataMode, type DataMode } from "@/config/env";
import { apolloFixtureHttp, createApolloAdapter, type ApolloRunOptions } from "./adapters/apollo/adapter";
import { createNewsletterAdapter, fixtureNewsletterSource } from "./adapters/newsletter/adapter";
import { createPagesAdapter, PAGES_USER_AGENT, pagesFixtureHttp } from "./adapters/pages/adapter";
import { createRelease3Adapter, RELEASE_3_SOURCES, type Release3Source } from "./adapters/release3/adapter";
import { createRssAdapter, rssFixtureHttp, WIRE_EXCERPT_CHARS } from "./adapters/rss/adapter";
import { createSecAdapter, secFixtureHttp } from "./adapters/sec/adapter";
import { liveHttp, recordingHttp, type HttpClient } from "./http";
import { RateLimiter } from "./rate-limit";
import type { SourceAdapter, SourceType } from "./types";

// Shared per process: every SEC request, from any workspace, goes through one limiter.
const secLimiter = new RateLimiter(150);
const pageLimiter = new RateLimiter(10_000);
const defaultLimiter = new RateLimiter(250);

export interface AdapterOptions {
  mode?: DataMode;
  now?: () => Date;
  /** Replaces the transport entirely (tests). */
  http?: HttpClient;
  apollo?: ApolloRunOptions;
  /** Uploaded newsletter CSV text, for an ingest triggered by an upload. */
  newsletterCsv?: string;
}

function transport(mode: DataMode, mock: HttpClient, live: () => HttpClient, name: string): HttpClient {
  if (mode === "mock") return mock;
  const client = live();
  return mode === "record" ? recordingHttp(client, name) : client;
}

export const INGESTIBLE_SOURCES: SourceType[] = ["apollo", "sec_8k", "press_wire", "google_alert", "leadership_page", "newsletter", ...RELEASE_3_SOURCES];

export function getAdapter(sourceType: SourceType, options: AdapterOptions = {}): SourceAdapter {
  const mode = options.mode ?? getDataMode();
  const now = options.now ?? (() => new Date());
  const pick = (mock: () => HttpClient, live: () => HttpClient, name: string) => options.http ?? transport(mode, mock(), live, name);

  switch (sourceType) {
    case "sec_8k":
      return createSecAdapter(pick(() => secFixtureHttp(now), () => liveHttp({ userAgent: process.env.SEC_USER_AGENT, limiter: secLimiter, limitKey: () => "sec" }), "sec"), process.env.SEC_USER_AGENT);
    case "press_wire":
      return createRssAdapter(pick(() => rssFixtureHttp("wires", now), () => liveHttp({ limiter: defaultLimiter }), "wires"), { key: "press_wire", label: "wire", excerptChars: WIRE_EXCERPT_CHARS });
    case "google_alert":
      return createRssAdapter(pick(() => rssFixtureHttp("alerts", now), () => liveHttp({ limiter: defaultLimiter }), "alerts"), { key: "google_alert", label: "Google Alerts", excerptChars: 5_000 });
    case "leadership_page":
      return createPagesAdapter(pick(() => pagesFixtureHttp(now), () => liveHttp({ userAgent: PAGES_USER_AGENT, limiter: pageLimiter }), "pages"), {
        jitter: mode === "mock" || options.http ? undefined : () => new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5_000))),
      });
    case "apollo":
      return createApolloAdapter(pick(() => apolloFixtureHttp(now), () => liveHttp({ limiter: defaultLimiter, limitKey: () => "apollo" }), "apollo"), options.apollo);
    case "newsletter":
      return createNewsletterAdapter(async (ctx) => options.newsletterCsv ?? (mode === "mock" ? ((await fixtureNewsletterSource(ctx)) ?? null) : null));
    default:
      if ((RELEASE_3_SOURCES as readonly string[]).includes(sourceType)) return createRelease3Adapter(sourceType as Release3Source, mode);
      throw new Error(`No adapter for ${sourceType}.`);
  }
}
