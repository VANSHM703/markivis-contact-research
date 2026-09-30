/**
 * The HTTP layer adapters talk through. One interface, three implementations (BRD 4.1):
 * live (real requests, rate limited, with a timeout), mock (answers from /fixtures), and
 * record (live, and saves each response, scrubbed, for review as a new fixture).
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DataMode } from "@/config/env";
import type { RateLimiter } from "./rate-limit";
import { scrub } from "./scrub";

export interface HttpRequest {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

export interface HttpClient {
  mode: DataMode;
  request(req: HttpRequest): Promise<HttpResponse>;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly detail?: string,
  ) {
    super(message);
  }
}

export interface LiveOptions {
  userAgent?: string;
  timeoutMs?: number;
  limiter?: RateLimiter;
  /** Rate-limit key for a request; defaults to the host. */
  limitKey?: (req: HttpRequest) => string;
}

export function liveHttp(options: LiveOptions = {}): HttpClient {
  return {
    mode: "live",
    async request(req) {
      const key = options.limitKey?.(req) ?? new URL(req.url).host;
      await options.limiter?.wait(key);
      const headers: Record<string, string> = { accept: "*/*", ...(options.userAgent ? { "user-agent": options.userAgent } : {}), ...req.headers };
      let body: string | undefined;
      if (req.body !== undefined) {
        body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        headers["content-type"] ??= "application/json";
      }
      let response: Response;
      try {
        response = await fetch(req.url, { method: req.method, headers, body, signal: AbortSignal.timeout(options.timeoutMs ?? 20_000), redirect: "follow" });
      } catch (error) {
        throw new HttpError(`Couldn't reach ${new URL(req.url).host}.`, null, (error as Error).message);
      }
      return { status: response.status, headers: Object.fromEntries(response.headers.entries()), text: await response.text() };
    },
  };
}

export type FixtureHandler = (req: HttpRequest) => Promise<HttpResponse | undefined> | HttpResponse | undefined;

/** Answers from fixtures; anything the handler does not know is a 404, never a network call. */
export function mockHttp(handler: FixtureHandler): HttpClient {
  return {
    mode: "mock",
    async request(req) {
      return (await handler(req)) ?? { status: 404, headers: {}, text: "No fixture for this request." };
    },
  };
}

/** Live requests, each response saved (scrubbed) under fixtures/recorded/<adapter>/ for review. */
export function recordingHttp(live: HttpClient, adapter: string, root = "fixtures/recorded"): HttpClient {
  return {
    mode: "record",
    async request(req) {
      const response = await live.request(req);
      const name = createHash("sha256").update(`${req.method} ${req.url} ${JSON.stringify(req.body ?? null)}`).digest("hex").slice(0, 16);
      const dir = path.join(root, adapter);
      await mkdir(dir, { recursive: true });
      const safeRequest = { method: req.method, url: scrub(req.url), body: req.body === undefined ? null : JSON.parse(scrub(JSON.stringify(req.body))) };
      await writeFile(path.join(dir, `${name}.json`), JSON.stringify({ request: safeRequest, status: response.status, text: scrub(response.text) }, null, 2));
      return response;
    },
  };
}

export const ok = (text: string, contentType = "application/json"): HttpResponse => ({ status: 200, headers: { "content-type": contentType }, text });

export function assertOk(response: HttpResponse, what: string): void {
  if (response.status >= 200 && response.status < 300) return;
  const detail = `HTTP ${response.status}: ${response.text.slice(0, 300)}`;
  if (response.status === 401 || response.status === 403) throw new HttpError(`${what} refused the credentials.`, response.status, detail);
  if (response.status === 429) throw new HttpError(`${what} is rate limiting requests. The next run will try again.`, response.status, detail);
  throw new HttpError(`${what} returned an error.`, response.status, detail);
}
