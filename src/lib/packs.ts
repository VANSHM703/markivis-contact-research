/**
 * Workspace packs (BRD 13). The executive search pack is on when `packs.exec_search` is true and
 * the matching flag `pack.exec_search` (BRD 2) has not been switched off. When it is off, every
 * pack element is hidden and its checks are skipped.
 */
import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { workspaces } from "@/db/schema";

export interface PackHolder {
  packs: unknown;
  flags: unknown;
}

export function execSearchOn(ws: PackHolder | null | undefined): boolean {
  if (!ws) return false;
  const packs = (ws.packs ?? {}) as Record<string, unknown>;
  const flags = (ws.flags ?? {}) as Record<string, unknown>;
  return packs.exec_search === true && flags["pack.exec_search"] !== false;
}

export async function execSearchOnFor(tx: Tx, workspaceId: string): Promise<boolean> {
  const [ws] = await tx.select({ packs: workspaces.packs, flags: workspaces.flags }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return execSearchOn(ws);
}
