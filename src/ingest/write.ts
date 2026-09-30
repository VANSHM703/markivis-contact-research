/** Writes fetched items into raw_items: suppression first, then an idempotent insert (BRD 8, 19). */
import { sql } from "drizzle-orm";
import { rawItems } from "@/db/schema";
import { isSuppressed } from "@/domain/suppression";
import type { Feed, RawItemInput, SourceType, WorkspaceCtx } from "./types";

export const MAX_BODY_CHARS = 50_000;

export interface WriteResult {
  fetched: number;
  created: number;
  duplicates: number;
  suppressed: number;
}

export async function writeRawItem(ctx: WorkspaceCtx, feed: Feed | null, sourceType: SourceType, item: RawItemInput, result: WriteResult): Promise<string | null> {
  result.fetched++;
  if (item.identifies && (await isSuppressed(ctx.tx, ctx.workspaceId, { emails: item.identifies.emails, linkedinUrls: item.identifies.linkedinUrls }))) {
    result.suppressed++;
    return null;
  }
  const [row] = await ctx.tx
    .insert(rawItems)
    .values({
      workspaceId: ctx.workspaceId,
      sourceType,
      feedId: feed?.id ?? null,
      externalId: item.externalId.slice(0, 500),
      url: item.url ?? null,
      title: item.title?.slice(0, 1000) ?? null,
      bodyText: item.bodyText ? item.bodyText.slice(0, MAX_BODY_CHARS) : null,
      publishedAt: item.publishedAt ?? null,
      payload: item.payload ?? null,
      processedAt: item.preProcessed ? ctx.now : null,
      outcome: item.preProcessed?.outcome ?? null,
    })
    .onConflictDoNothing({ target: [rawItems.workspaceId, rawItems.sourceType, rawItems.externalId] })
    .returning({ id: rawItems.id });
  if (row) result.created++;
  else result.duplicates++;
  return row?.id ?? null;
}

/** Latest raw item for a key prefix, for adapters that diff against their previous capture. */
export async function latestRawItem(ctx: WorkspaceCtx, sourceType: SourceType, externalIdPrefix: string) {
  const rows = await ctx.tx
    .select()
    .from(rawItems)
    .where(sql`${rawItems.sourceType} = ${sourceType} and ${rawItems.externalId} like ${`${externalIdPrefix}%`}`)
    .orderBy(sql`${rawItems.createdAt} desc`)
    .limit(1);
  return rows[0] ?? null;
}
