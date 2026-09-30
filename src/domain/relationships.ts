/**
 * Relationship band lookups for actions, Today and the digest. Scores themselves are computed in
 * M8 (BRD 11.4); until a score exists the band is null and treated as unknown, not as cold.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { relationshipScores } from "@/db/schema";

export type Band = "strong" | "warm" | "cooling" | "cold" | "none";

export interface BandInfo {
  band: Band;
  score: number;
  lastTwoWayAt: Date | null;
}

/** The user's own band with the person when one exists, else the firm-level band. */
export async function bandFor(tx: Tx, personId: string, userId?: string | null): Promise<BandInfo | null> {
  const rows = await tx
    .select({ userId: relationshipScores.userId, band: relationshipScores.band, score: relationshipScores.score, lastTwoWayAt: relationshipScores.lastTwoWayAt })
    .from(relationshipScores)
    .where(and(eq(relationshipScores.personId, personId), userId ? or(isNull(relationshipScores.userId), eq(relationshipScores.userId, userId)) : isNull(relationshipScores.userId)));
  const row = rows.find((r) => r.userId === userId) ?? rows.find((r) => r.userId === null);
  return row ? { band: row.band, score: row.score, lastTwoWayAt: row.lastTwoWayAt } : null;
}

/** Firm-level bands for many people at once. */
export async function firmBands(tx: Tx, personIds: string[]): Promise<Map<string, Band>> {
  if (personIds.length === 0) return new Map();
  const rows = await tx
    .select({ personId: relationshipScores.personId, band: relationshipScores.band })
    .from(relationshipScores)
    .where(and(inArray(relationshipScores.personId, personIds), isNull(relationshipScores.userId)));
  return new Map(rows.map((r) => [r.personId, r.band]));
}

export const isWarmOrStrong = (band: Band | null | undefined) => band === "strong" || band === "warm";
