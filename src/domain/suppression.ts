/**
 * Suppression list (BRD 6.6 and 18.1). Stores only a salted SHA-256 of a normalised email or
 * LinkedIn URL, and is checked before any record that identifies a person is created.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { suppressions, workspaces } from "@/db/schema";
import { canonicalLinkedinUrl, normaliseEmail } from "@/lib/normalise";

export type SuppressionKind = "email" | "linkedin";

export function suppressionHash(salt: string, kind: SuppressionKind, value: string): string | null {
  const normalised = kind === "email" ? normaliseEmail(value) : canonicalLinkedinUrl(value);
  if (!normalised) return null;
  return createHash("sha256").update(`${salt}:${kind}:${normalised}`).digest("hex");
}

async function salt(tx: Tx, workspaceId: string): Promise<string> {
  const [ws] = await tx.select({ salt: workspaces.suppressionSalt }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!ws) throw new Error("Workspace not found in this scope.");
  return ws.salt;
}

export class SuppressedError extends Error {
  constructor() {
    // Deliberately says nothing about which identifier matched.
    super("This person is on the suppression list and cannot be added.");
  }
}

/** True when any of the identifiers is suppressed in the workspace. */
export async function isSuppressed(
  tx: Tx,
  workspaceId: string,
  ids: { emails?: (string | null | undefined)[]; linkedinUrls?: (string | null | undefined)[] },
): Promise<boolean> {
  const s = await salt(tx, workspaceId);
  const email = (ids.emails ?? []).flatMap((v) => (v ? [suppressionHash(s, "email", v)] : [])).filter((h): h is string => !!h);
  const linkedin = (ids.linkedinUrls ?? []).flatMap((v) => (v ? [suppressionHash(s, "linkedin", v)] : [])).filter((h): h is string => !!h);
  const hashes = [...email, ...linkedin];
  if (hashes.length === 0) return false;
  const rows = await tx.select({ id: suppressions.id }).from(suppressions).where(inArray(suppressions.hash, hashes)).limit(1);
  return rows.length > 0;
}

export async function addSuppression(
  tx: Tx,
  workspaceId: string,
  kind: SuppressionKind,
  value: string,
  reason: "erasure" | "opt_out" | "do_not_contact",
): Promise<boolean> {
  const hash = suppressionHash(await salt(tx, workspaceId), kind, value);
  if (!hash) return false;
  const existing = await tx.select({ id: suppressions.id }).from(suppressions).where(and(eq(suppressions.kind, kind), eq(suppressions.hash, hash))).limit(1);
  if (existing.length === 0) await tx.insert(suppressions).values({ workspaceId, kind, hash, reason });
  return true;
}
