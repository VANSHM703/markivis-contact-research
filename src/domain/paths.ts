/**
 * Warm path finder (BRD 11.7). For a target T:
 *   1. Direct: when the firm band with T is strong or warm, strength score/100, owned by the user
 *      with the highest per-user score.
 *   2. One hop, Us to C to T: for each connection C of T whose firm band is warm or strong and who
 *      may be contacted, strength min(score(C)/100, weight(C, T)).
 * The top 3 by strength; ties go to the more recent two-way touch with C. Two hops are P2.
 * A path of 0.40 or more counts toward the warm-path goal.
 */
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { persons, relationshipScores, roles, users } from "@/db/schema";
import { connectionsOf } from "./connections";
import type { Band } from "./scoring";

export const WARM_PATH_THRESHOLD = 0.4;

export interface WarmPath {
  kind: "direct" | "one_hop";
  strength: number;
  connector_person_id?: string;
  connector_name?: string;
  connection_type?: string;
  owner_user_id: string | null;
  owner_name: string | null;
  explanation: string;
}

const year = (d: string | null) => (d ? d.slice(0, 4) : null);
const warm = (b: Band | undefined) => b === "strong" || b === "warm";

/** Who knows a person best: the user with the highest per-user score. */
async function bestOwner(tx: Tx, personId: string): Promise<{ id: string; name: string } | null> {
  const [row] = await tx
    .select({ id: users.id, name: users.name })
    .from(relationshipScores)
    .innerJoin(users, eq(users.id, relationshipScores.userId))
    .where(and(eq(relationshipScores.personId, personId), isNotNull(relationshipScores.userId)))
    .orderBy(desc(relationshipScores.score), desc(relationshipScores.lastTwoWayAt))
    .limit(1);
  return row ?? null;
}

function sentence(ownerName: string | null, band: Band, connector: string, target: string, c: { type: string; companyName: string | null; periodStart: string | null; periodEnd: string | null; note: string | null }, today: string, seats: { connectorOnBoard: boolean; targetOnBoard: boolean }): string {
  const who = ownerName ?? "The firm";
  const from = year(c.periodStart);
  const to = c.periodEnd && c.periodEnd < today ? year(c.periodEnd) : "today";
  const span = from ? ` from ${from} to ${to}` : "";
  const at = c.companyName ? ` ${c.companyName}` : "";
  const how =
    c.type === "shared_board" && seats.connectorOnBoard && seats.targetOnBoard ? `who sat on the${at} board with ${target}${span}`
    : c.type === "shared_board" && seats.connectorOnBoard ? `who sat on the${at} board while ${target} was an executive there${span}`
    : c.type === "shared_board" ? `who was an executive at${at || " the company"} while ${target} sat on its board${span}`
    : c.type === "overlapping_tenure" ? `who worked with ${target} at${at || " the same company"}${span}`
    : c.type === "reported_to" ? `who has a reporting line with ${target}`
    : c.type === "introduced_by" ? `who introduced ${target} to the firm`
    : c.type === "deal_counterpart" ? `who was on the other side of a deal with ${target}`
    : `who knows ${target}${c.note ? ` (${c.note})` : ""}`;
  return `${who} has a ${band} relationship with ${connector}, ${how}.`;
}

async function onBoard(tx: Tx, personId: string, companyId: string | null): Promise<boolean> {
  if (!companyId) return false;
  const [row] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.personId, personId), eq(roles.companyId, companyId), eq(roles.seatType, "board"))).limit(1);
  return !!row;
}

export async function findPaths(tx: Tx, targetId: string, today = new Date().toISOString().slice(0, 10), limit = 3): Promise<WarmPath[]> {
  const [target] = await tx.select({ id: persons.id, name: persons.fullName }).from(persons).where(eq(persons.id, targetId)).limit(1);
  if (!target) return [];
  const paths: (WarmPath & { tieBreak: number })[] = [];

  const [direct] = await tx.select().from(relationshipScores).where(and(eq(relationshipScores.personId, targetId), isNull(relationshipScores.userId))).limit(1);
  if (direct && warm(direct.band)) {
    const owner = await bestOwner(tx, targetId);
    paths.push({
      kind: "direct",
      strength: direct.score / 100,
      owner_user_id: owner?.id ?? null,
      owner_name: owner?.name ?? null,
      explanation: `${owner?.name ?? "The firm"} has a ${direct.band} relationship with ${target.name} directly (${direct.score} / 100).`,
      tieBreak: direct.lastTwoWayAt?.getTime() ?? 0,
    });
  }

  const links = (await connectionsOf(tx, targetId)).filter((c) => !c.otherMerged && c.otherStatus !== "do_not_contact");
  const scores = links.length
    ? await tx.select().from(relationshipScores).where(and(inArray(relationshipScores.personId, links.map((l) => l.otherId)), isNull(relationshipScores.userId)))
    : [];
  // One path per connector: their strongest tie to the target.
  const byConnector = new Map<string, WarmPath & { tieBreak: number }>();
  for (const link of links) {
    const s = scores.find((x) => x.personId === link.otherId);
    if (!s || !warm(s.band)) continue;
    const strength = Math.min(s.score / 100, link.weight);
    const prev = byConnector.get(link.otherId);
    if (prev && prev.strength >= strength) continue;
    const owner = await bestOwner(tx, link.otherId);
    byConnector.set(link.otherId, {
      kind: "one_hop",
      strength,
      connector_person_id: link.otherId,
      connector_name: link.otherName,
      connection_type: link.type,
      owner_user_id: owner?.id ?? null,
      owner_name: owner?.name ?? null,
      explanation: sentence(owner?.name ?? null, s.band, link.otherName, target.name, link, today, {
        connectorOnBoard: await onBoard(tx, link.otherId, link.companyId),
        targetOnBoard: await onBoard(tx, targetId, link.companyId),
      }),
      tieBreak: s.lastTwoWayAt?.getTime() ?? 0,
    });
  }
  const oneHop = Array.from(byConnector.values()).sort((a, b) => b.strength - a.strength || b.tieBreak - a.tieBreak);
  return [...paths, ...oneHop].slice(0, limit).map(({ tieBreak: _t, ...p }) => ({ ...p, strength: Math.round(p.strength * 100) / 100 }));
}
