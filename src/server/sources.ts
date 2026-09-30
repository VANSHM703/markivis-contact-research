/** Read queries for Settings, Sources. */
import { and, eq, gte, sql } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { feeds, rawItems, usageCounters } from "@/db/schema";
import { hasWorkspaceSecret } from "@/domain/secrets";
import { periodOf } from "@/ingest/usage";

export async function getSourcesOverview(workspaceId: string, now = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  return withWorkspace(workspaceId, async (tx) => {
    const rows = await tx
      .select({
        feed: feeds,
        items7d: sql<number>`(select count(*)::int from ${rawItems} r where r.feed_id = ${feeds}.id and r.created_at >= ${weekAgo})`,
      })
      .from(feeds)
      .orderBy(feeds.sourceType, feeds.name);
    const [usage] = await tx.select().from(usageCounters).where(and(eq(usageCounters.provider, "apollo"), eq(usageCounters.period, periodOf(now)))).limit(1);
    const apolloKey = await hasWorkspaceSecret(tx, workspaceId, "apollo_api_key");
    const [recent] = await tx.select({ n: sql<number>`count(*)::int` }).from(rawItems).where(gte(rawItems.createdAt, weekAgo));
    return { feeds: rows, apolloCreditsUsed: usage?.units ?? 0, apolloKey, rawItems7d: recent?.n ?? 0 };
  });
}
