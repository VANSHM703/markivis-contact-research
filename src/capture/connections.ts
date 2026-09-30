/**
 * Mailbox and calendar connections (BRD 11.1, 6.2 oauth_connections). One per user and provider.
 * Tokens are encrypted at rest; revoking deletes them at once and stops sync. In mock mode a
 * connection has no tokens and reads fixtures.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDataMode } from "@/config/env";
import { withWorkspace, type Tx } from "@/db/client";
import { oauthConnections } from "@/db/schema";
import { liveHttp, type HttpClient } from "@/ingest/http";
import { audit } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createGoogleProvider } from "./google";
import { createMicrosoftProvider } from "./microsoft";
import { createMockProvider } from "./mock";
import { oauthConfig, refreshTokens, type TokenSet } from "./oauth";
import type { CaptureProvider, CaptureProviderName } from "./types";

export type Connection = typeof oauthConnections.$inferSelect;

export async function saveConnection(
  tx: Tx,
  input: { workspaceId: string; userId: string; provider: CaptureProviderName; accountEmail: string; tokens: TokenSet | null; mock?: boolean },
): Promise<string> {
  const sealed = input.tokens ? encryptSecret(JSON.stringify(input.tokens)) : null;
  const values = {
    scopes: input.tokens?.scopes ?? (input.mock ? ["mock"] : []),
    tokenCiphertext: sealed?.ciphertext ?? null,
    tokenKeyId: sealed?.keyId ?? null,
    status: "active" as const,
    accountEmail: input.accountEmail.toLowerCase(),
    errorMessage: null,
  };
  const [row] = await tx
    .insert(oauthConnections)
    .values({ workspaceId: input.workspaceId, userId: input.userId, provider: input.provider, ...values })
    .onConflictDoUpdate({
      target: [oauthConnections.workspaceId, oauthConnections.userId, oauthConnections.provider],
      // Reconnecting the same mailbox (for example to allow sending) keeps its sync position.
      set: { ...values, deltaCursor: sql`case when ${oauthConnections.accountEmail} = ${values.accountEmail} then ${oauthConnections.deltaCursor} else null end` },
    })
    .returning({ id: oauthConnections.id });
  await audit(tx, { workspaceId: input.workspaceId, actorUserId: input.userId, actorKind: "user", action: "connection.connected", entityType: "oauth_connection", entityId: row!.id, after: { provider: input.provider, scopes: values.scopes, mock: !!input.mock } });
  return row!.id;
}

/** Revocation deletes the tokens immediately and stops sync (BRD 11.1). Captured history is kept. */
export async function revokeConnection(tx: Tx, actor: { workspaceId: string; userId: string }, provider: CaptureProviderName): Promise<boolean> {
  const rows = await tx
    .update(oauthConnections)
    .set({ tokenCiphertext: null, tokenKeyId: null, status: "revoked", deltaCursor: null, errorMessage: null })
    .where(and(eq(oauthConnections.userId, actor.userId), eq(oauthConnections.provider, provider)))
    .returning({ id: oauthConnections.id });
  if (rows[0]) await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "connection.revoked", entityType: "oauth_connection", entityId: rows[0].id, after: { provider } });
  return rows.length > 0;
}

export function isMockConnection(c: Pick<Connection, "scopes">): boolean {
  return c.scopes.includes("mock");
}

/** An access token getter for a live connection: refreshed a minute before expiry, and saved. */
export function providerAccessToken(c: Connection, http: HttpClient): () => Promise<string> {
  const provider = c.provider as CaptureProviderName;
  let tokens: TokenSet | null = c.tokenCiphertext ? (JSON.parse(decryptSecret(c.tokenCiphertext)) as TokenSet) : null;
  return async () => {
    if (!tokens) throw new Error("This connection has no tokens. Connect it again.");
    if (tokens.expiresAt - Date.now() < 60_000) {
      tokens = await refreshTokens(http, oauthConfig(provider), tokens);
      const sealed = encryptSecret(JSON.stringify(tokens));
      await withWorkspace(c.workspaceId, (tx) => tx.update(oauthConnections).set({ tokenCiphertext: sealed.ciphertext, tokenKeyId: sealed.keyId }).where(eq(oauthConnections.id, c.id)));
    }
    return tokens.accessToken;
  };
}

/** The provider for a connection: fixtures for a mock connection, the live API otherwise. */
export function providerFor(c: Connection, options: { http?: HttpClient; now?: () => Date } = {}): CaptureProvider {
  const provider = c.provider as CaptureProviderName;
  if (isMockConnection(c) || getDataMode() === "mock") return createMockProvider(provider, c.accountEmail ?? "", options.now);
  const http = options.http ?? liveHttp({ timeoutMs: 30_000 });
  const accessToken = providerAccessToken(c, http);
  return provider === "microsoft" ? createMicrosoftProvider(http, accessToken) : createGoogleProvider(http, accessToken);
}
