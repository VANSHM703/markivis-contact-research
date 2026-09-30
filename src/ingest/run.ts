/**
 * Runs one source for one workspace: every enabled feed of that source type, each feed in its own
 * transaction so one failing feed never loses another's items. Records feed health, and raises
 * an adapter health alert after three failed runs in a row (BRD 19 observability).
 */
import { and, eq } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { feeds, workspaces } from "@/db/schema";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { applyNewsletterEvents } from "./adapters/newsletter/adapter";
import { HttpError } from "./http";
import { getAdapter, type AdapterOptions } from "./registry";
import { SOURCE_FLAGS, type Feed, type HealthResult, type SourceType, type WorkspaceCtx } from "./types";
import { writeRawItem, type WriteResult } from "./write";

export const FAILURE_ALERT_THRESHOLD = 3;

export interface FeedRunResult extends WriteResult {
  feedId: string;
  feedName: string;
  ok: boolean;
  error?: string;
}

export interface SourceRunResult {
  sourceType: SourceType;
  skipped?: "flag_off" | "no_feeds";
  feeds: FeedRunResult[];
}

export async function context(workspaceId: string, now: Date, tx: WorkspaceCtx["tx"]): Promise<WorkspaceCtx> {
  const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!ws) throw new Error("Workspace not found.");
  return { workspaceId, timezone: ws.timezone, flags: ws.flags as Record<string, boolean>, settings: ws.settings as Record<string, unknown>, now, tx };
}

export async function runSource(workspaceId: string, sourceType: SourceType, options: AdapterOptions & { now?: () => Date; feedId?: string } = {}): Promise<SourceRunResult> {
  const now = options.now ?? (() => new Date());
  const { flagOn, feedRows } = await withWorkspace(workspaceId, async (tx) => {
    const ctx = await context(workspaceId, now(), tx);
    const flag = SOURCE_FLAGS[sourceType];
    const rows = await tx.select().from(feeds).where(and(eq(feeds.sourceType, sourceType), eq(feeds.enabled, true)));
    return { flagOn: !flag || ctx.flags[flag] === true, feedRows: options.feedId ? rows.filter((f) => f.id === options.feedId) : rows };
  });
  if (!flagOn) return { sourceType, skipped: "flag_off", feeds: [] };
  if (feedRows.length === 0) return { sourceType, skipped: "no_feeds", feeds: [] };

  const results: FeedRunResult[] = [];
  for (const feed of feedRows) {
    const started = now();
    const result: FeedRunResult = { feedId: feed.id, feedName: feed.name, ok: true, fetched: 0, created: 0, duplicates: 0, suppressed: 0 };
    try {
      await withWorkspace(workspaceId, (tx) => ingestFeed(tx, workspaceId, feed, started, result, { ...options, now }));
    } catch (error) {
      result.ok = false;
      result.error = error instanceof HttpError && error.detail ? `${error.message} ${error.detail}` : (error as Error).message;
      await recordFailure(workspaceId, feed, started, result.error);
    }
    log.info("ingest.feed", { workspaceId, sourceType, ...result });
    results.push(result);
  }
  return { sourceType, feeds: results };
}

/**
 * One feed, inside the caller's transaction: fetch, write raw items, apply what applies
 * immediately (newsletter events), and mark the feed healthy. Throws on failure.
 */
export async function ingestFeed(tx: WorkspaceCtx["tx"], workspaceId: string, feed: Feed, started: Date, result: WriteResult, options: AdapterOptions = {}): Promise<void> {
  const ctx = await context(workspaceId, started, tx);
  const adapter = getAdapter(feed.sourceType, options);
  for await (const item of adapter.fetch(ctx, feed, feed.lastSuccessAt)) await writeRawItem(ctx, feed, feed.sourceType, item, result);
  if (feed.sourceType === "newsletter") await applyNewsletterEvents(ctx);
  await tx.update(feeds).set({ lastRunAt: started, lastSuccessAt: started, lastError: null, consecutiveFailures: 0 }).where(eq(feeds.id, feed.id));
}

async function recordFailure(workspaceId: string, feed: Feed, at: Date, message: string): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const failures = feed.consecutiveFailures + 1;
    await tx.update(feeds).set({ lastRunAt: at, lastError: message.slice(0, 2000), consecutiveFailures: failures }).where(eq(feeds.id, feed.id));
    if (failures === FAILURE_ALERT_THRESHOLD) {
      await audit(tx, { workspaceId, actorUserId: null, actorKind: "system", action: "source.failing", entityType: "feed", entityId: feed.id, after: { source_type: feed.sourceType, failures, message: message.slice(0, 500) } });
    }
  });
}

export async function checkSourceHealth(workspaceId: string, feedId: string, options: AdapterOptions = {}): Promise<HealthResult> {
  return withWorkspace(workspaceId, async (tx) => {
    const [feed] = await tx.select().from(feeds).where(eq(feeds.id, feedId)).limit(1);
    if (!feed) return { ok: false, message: "Feed not found." };
    const ctx = await context(workspaceId, (options.now ?? (() => new Date()))(), tx);
    try {
      return await getAdapter(feed.sourceType, options).healthCheck(ctx, feed);
    } catch (error) {
      return { ok: false, message: "The check could not finish.", detail: (error as Error).message };
    }
  });
}
