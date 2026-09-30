/**
 * Release 3 sources (BRD 8.8): licensed executive data (for example BoardEx), a news API, state
 * WARN notices and job-posting volumes. Interfaces and mock implementations only; their feature
 * flags are off at launch and there is no live implementation.
 */
import { readJsonFixture } from "../../fixtures";
import type { HealthResult, RawItemInput, SourceAdapter, SourceType, WorkspaceCtx } from "../../types";

export const RELEASE_3_SOURCES = ["licensed", "news_api", "warn", "job_postings"] as const satisfies readonly SourceType[];
export type Release3Source = (typeof RELEASE_3_SOURCES)[number];

export class NotAvailableAtLaunchError extends Error {}

export function createRelease3Adapter(key: Release3Source, mode: "live" | "mock" | "record"): SourceAdapter {
  return {
    key,
    async *fetch(ctx: WorkspaceCtx): AsyncIterable<RawItemInput> {
      if (mode !== "mock") throw new NotAvailableAtLaunchError(`The ${key} source is planned for a later release and has no live connection yet.`);
      const items = (await readJsonFixture<(RawItemInput & { publishedAt?: string })[]>(`${key}/items.json`, ctx.now)) ?? [];
      for (const item of items) yield { ...item, publishedAt: item.publishedAt ? new Date(item.publishedAt) : null };
    },
    async healthCheck(): Promise<HealthResult> {
      return mode === "mock" ? { ok: true, message: "Mock data only. This source is planned for a later release." } : { ok: false, message: "This source is planned for a later release and has no live connection yet." };
    },
  };
}
