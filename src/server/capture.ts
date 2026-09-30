/** Read queries for connections, exclusions and a person's interactions (BRD 11, 16.2). */
import { and, asc, count, desc, eq } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { captureExclusions, interactions, oauthConnections, users } from "@/db/schema";
import { canSeeDetail, isPersonPrivate, privateThreads } from "@/capture/privacy";
import type { RequestContext } from "@/lib/context";

export async function connectionsFor(ctx: RequestContext) {
  return withWorkspace(ctx.workspace.id, async (tx) => ({
    connections: await tx
      .select({ provider: oauthConnections.provider, status: oauthConnections.status, accountEmail: oauthConnections.accountEmail, lastSyncAt: oauthConnections.lastSyncAt, calendarSyncedAt: oauthConnections.calendarSyncedAt, errorMessage: oauthConnections.errorMessage, scopes: oauthConnections.scopes })
      .from(oauthConnections)
      .where(eq(oauthConnections.userId, ctx.user.id)),
    exclusions: await tx.select({ id: captureExclusions.id, pattern: captureExclusions.pattern }).from(captureExclusions).where(eq(captureExclusions.userId, ctx.user.id)).orderBy(asc(captureExclusions.pattern)),
    captured: (await tx.select({ n: count() }).from(interactions).where(and(eq(interactions.ourUserId, ctx.user.id), eq(interactions.capturedBy, "auto"))))[0]?.n ?? 0,
  }));
}

export interface InteractionView {
  id: string;
  channel: string;
  direction: string;
  occurredAt: Date;
  subject: string | null;
  summary: string | null;
  /** True when this viewer may not read the subject or summary. */
  hidden: boolean;
  isPrivate: boolean;
  threadKey: string | null;
  threadPrivate: boolean;
  provider: string;
  capturedBy: string;
  ourUserName: string | null;
}

/**
 * A person's interactions, newest first. Subjects and summaries are removed on the server for
 * roles without subject access, and for everyone but the partner on private items (scenario 12).
 */
export async function interactionsFor(ctx: RequestContext, personId: string, limit = 100): Promise<{ rows: InteractionView[]; total: number; personPrivate: boolean }> {
  return withWorkspace(ctx.workspace.id, async (tx) => {
    const rows = await tx
      .select({ i: interactions, ourUserName: users.name })
      .from(interactions)
      .leftJoin(users, eq(users.id, interactions.ourUserId))
      .where(eq(interactions.personId, personId))
      .orderBy(desc(interactions.occurredAt))
      .limit(limit);
    const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(interactions).where(eq(interactions.personId, personId));
    const threads = await privateThreads(tx, Array.from(new Set(rows.map((r) => r.i.threadKey).filter((k): k is string => !!k))));
    return {
      total,
      personPrivate: await isPersonPrivate(tx, personId),
      rows: rows.map(({ i, ourUserName }) => {
        const visible = canSeeDetail(ctx.role, i.isPrivate);
        return {
          id: i.id,
          channel: i.channel,
          direction: i.direction,
          occurredAt: i.occurredAt,
          subject: visible ? i.subject : null,
          summary: visible ? i.summary : null,
          hidden: !visible && !!(i.subject || i.summary),
          isPrivate: i.isPrivate,
          threadKey: i.threadKey,
          threadPrivate: !!i.threadKey && threads.has(i.threadKey),
          provider: i.provider,
          capturedBy: i.capturedBy,
          ourUserName,
        };
      }),
    };
  });
}
