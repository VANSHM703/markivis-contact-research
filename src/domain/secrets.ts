/** Per-workspace credentials (BRD 6.6, 20.2): encrypted at rest, write-only from the interface. */
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { workspaceSecrets } from "@/db/schema";
import { audit } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export type SecretKind = "apollo_api_key" | "hubspot_private_app_token" | "newsletter_api_key";

export async function setWorkspaceSecret(tx: Tx, workspaceId: string, kind: SecretKind, value: string, userId: string | null): Promise<void> {
  const { ciphertext, keyId } = encryptSecret(value.trim());
  await tx
    .insert(workspaceSecrets)
    .values({ workspaceId, kind, ciphertext, keyId, updatedBy: userId })
    .onConflictDoUpdate({ target: [workspaceSecrets.workspaceId, workspaceSecrets.kind], set: { ciphertext, keyId, updatedBy: userId, updatedAt: new Date() } });
  // The audit entry records that the secret changed, never its value.
  await audit(tx, { workspaceId, actorUserId: userId, actorKind: userId ? "user" : "system", action: "secret.set", entityType: "workspace_secret", after: { kind } });
}

/** For adapters only. Never return the result from an API route or render it. */
export async function readWorkspaceSecret(tx: Tx, workspaceId: string, kind: SecretKind): Promise<string | null> {
  const [row] = await tx.select().from(workspaceSecrets).where(and(eq(workspaceSecrets.workspaceId, workspaceId), eq(workspaceSecrets.kind, kind))).limit(1);
  return row ? decryptSecret(row.ciphertext) : null;
}

export async function hasWorkspaceSecret(tx: Tx, workspaceId: string, kind: SecretKind): Promise<{ set: boolean; updatedAt: Date | null }> {
  const [row] = await tx.select({ updatedAt: workspaceSecrets.updatedAt }).from(workspaceSecrets).where(and(eq(workspaceSecrets.workspaceId, workspaceId), eq(workspaceSecrets.kind, kind))).limit(1);
  return { set: !!row, updatedAt: row?.updatedAt ?? null };
}
