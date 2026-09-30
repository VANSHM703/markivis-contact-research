/**
 * Source adapter contract (BRD 8). Adapters only fetch and write raw_items; the pipeline (M4)
 * turns raw items into signals. Every adapter is one implementation over an HttpClient, and the
 * client is live, mock (fixtures) or record (live, saving fixtures), selected by DATA_MODE.
 */
import type { Tx } from "@/db/client";
import type { feeds } from "@/db/schema";

export type SourceType = (typeof feeds.$inferSelect)["sourceType"];
export type Feed = typeof feeds.$inferSelect;

export interface WorkspaceCtx {
  workspaceId: string;
  timezone: string;
  flags: Record<string, boolean>;
  settings: Record<string, unknown>;
  /** The clock for this run; injected so tests and fixtures are deterministic. */
  now: Date;
  /** Database access, always scoped to this workspace. */
  tx: Tx;
}

export interface RawItemInput {
  /** Stable across runs: the dedupe key for idempotent ingestion. */
  externalId: string;
  url?: string | null;
  title?: string | null;
  bodyText?: string | null;
  publishedAt?: Date | null;
  payload?: Record<string, unknown>;
  /** Emails or LinkedIn URLs the item identifies, checked against the suppression list first. */
  identifies?: { emails?: string[]; linkedinUrls?: string[] };
  /** Set for items the pipeline must skip (for example a page snapshot kept only for diffing). */
  preProcessed?: { outcome: "irrelevant" | "record_updated" };
}

export interface HealthResult {
  ok: boolean;
  message: string;
  /** The provider's own message, shown in mono below the plain explanation (design file 9.10). */
  detail?: string;
}

export interface SourceAdapter {
  key: SourceType;
  fetch(ctx: WorkspaceCtx, feed: Feed, since: Date | null): AsyncIterable<RawItemInput>;
  healthCheck(ctx: WorkspaceCtx, feed: Feed): Promise<HealthResult>;
}

/** Workspace flag that switches each source on or off (BRD 2). */
export const SOURCE_FLAGS: Partial<Record<SourceType, string>> = {
  apollo: "source.apollo",
  sec_8k: "source.sec",
  press_wire: "source.wires",
  google_alert: "source.alerts",
  leadership_page: "source.pages",
  newsletter: "source.newsletter",
  licensed: "source.licensed",
  news_api: "source.news",
  warn: "source.warn",
  job_postings: "source.jobs",
};
