/**
 * Relationship scores (BRD 11.4): lookups for actions, Today and the digest, and the nightly
 * recompute. Before the first run a person has no score, shown as "Not scored", not as cold.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { withWorkspace, type Tx } from "@/db/client";
import { interactions, persons, relationshipScores, workspaces } from "@/db/schema";
import { computeScore, scoringSettings, type Band, type ScoringSettings } from "./scoring";

export type { Band };

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

// ---------------------------------------------------------------------------------------------
// Recomputing scores (BRD 11.4, rel.score nightly)
// ---------------------------------------------------------------------------------------------

export interface ScoreRow {
  personId: string;
  ourUserId: string | null;
  channel: string;
  direction: string;
  occurredAt: Date;
  threadKey: string | null;
}

async function interactionRows(tx: Tx, personIds?: string[]): Promise<ScoreRow[]> {
  return tx
    .select({ personId: interactions.personId, ourUserId: interactions.ourUserId, channel: interactions.channel, direction: interactions.direction, occurredAt: interactions.occurredAt, threadKey: interactions.threadKey })
    .from(interactions)
    .where(personIds ? inArray(interactions.personId, personIds) : undefined);
}

/**
 * Firm-level and per-user scores for every tracked person, from all their interactions. Per-user
 * scores use only the interactions that user took part in. Idempotent: rows are replaced.
 */
export async function recomputeScores(workspaceId: string, now = new Date()): Promise<{ people: number; firm: Record<Band, number> }> {
  return withWorkspace(workspaceId, async (tx) => {
    const [ws] = await tx.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const settings = scoringSettings(ws!.settings as Record<string, unknown>);
    const people = await tx.select({ id: persons.id }).from(persons).where(and(eq(persons.isTracked, true), isNull(persons.mergedIntoId)));
    const byPerson = new Map<string, ScoreRow[]>();
    for (const r of await interactionRows(tx)) byPerson.set(r.personId, [...(byPerson.get(r.personId) ?? []), r]);

    const firm: Record<Band, number> = { strong: 0, warm: 0, cooling: 0, cold: 0, none: 0 };
    const rows: (typeof relationshipScores.$inferInsert)[] = [];
    for (const { id } of people) {
      const list = byPerson.get(id) ?? [];
      const result = computeScore(list, now, settings);
      firm[result.band]++;
      rows.push({ workspaceId, personId: id, userId: null, score: result.score, band: result.band, factors: result.factors, lastTwoWayAt: result.lastTwoWayAt, computedAt: now });
      const users = new Set(list.map((r) => r.ourUserId).filter((u): u is string => !!u));
      for (const userId of users) {
        const mine = computeScore(list.filter((r) => r.ourUserId === userId), now, settings);
        rows.push({ workspaceId, personId: id, userId, score: mine.score, band: mine.band, factors: mine.factors, lastTwoWayAt: mine.lastTwoWayAt, computedAt: now });
      }
    }
    await tx.delete(relationshipScores);
    for (let i = 0; i < rows.length; i += 250) await tx.insert(relationshipScores).values(rows.slice(i, i + 250));
    return { people: people.length, firm };
  });
}

/** The firm-level score as of an earlier date, recomputed from the interactions up to then. */
export function scoreAsOf(rows: ScoreRow[], asOf: Date, settings: ScoringSettings) {
  return computeScore(rows, asOf, settings);
}

export { interactionRows };
