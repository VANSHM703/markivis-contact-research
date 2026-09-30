/**
 * Going-quiet alerts (BRD 11.5, rel.quiet daily). For each priority person whose firm-level band
 * was strong or warm at any point in the last 180 days, with no two-way touch for
 * `settings.quiet_days` (default 90) and no open re-engage action: a confirmed priority 2
 * `internal_relationship_quiet` signal and a `reengage` action. At most one per person per 90 days.
 *
 * "At any point" is checked by recomputing the firm score weekly back over the 180 days from the
 * interactions as they stood then, so no score history needs storing.
 */
import { and, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { actions, persons, signals, workspaces } from "@/db/schema";
import { actionsToDraft, createActionForSignal, OPEN_STATUSES } from "./actions";
import { interactionRows, type ScoreRow } from "./relationships";
import { computeScore, scoringSettings, type ScoringSettings } from "./scoring";

const DAY = 86_400_000;
export const QUIET_LOOKBACK_DAYS = 180;
export const QUIET_REPEAT_DAYS = 90;

/** Pure: whether the person has gone quiet as of `now`. */
export function isGoingQuiet(rows: ScoreRow[], now: Date, settings: ScoringSettings, quietDays: number): { quiet: boolean; daysSilent: number | null } {
  const current = computeScore(rows, now, settings);
  const daysSilent = current.lastTwoWayAt ? Math.floor((now.getTime() - current.lastTwoWayAt.getTime()) / DAY) : null;
  if (daysSilent !== null && daysSilent < quietDays) return { quiet: false, daysSilent };
  for (let back = 0; back <= QUIET_LOOKBACK_DAYS; back += 7) {
    const band = computeScore(rows, new Date(now.getTime() - back * DAY), settings).band;
    if (band === "strong" || band === "warm") return { quiet: daysSilent !== null, daysSilent };
  }
  return { quiet: false, daysSilent };
}

export async function raiseGoingQuiet(workspaceId: string, now = new Date()): Promise<{ checked: number; raised: number; toDraft: string[] }> {
  return withWorkspace(workspaceId, async (tx) => {
    const [ws] = await tx.select({ settings: workspaces.settings, flags: workspaces.flags }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if ((ws!.flags as Record<string, boolean>)["rel.quiet"] === false) return { checked: 0, raised: 0, toDraft: [] };
    const settings = ws!.settings as Record<string, unknown>;
    const scoring = scoringSettings(settings);
    const quietDays = Number(settings.quiet_days ?? 90);
    const people = await tx
      .select({ id: persons.id, name: persons.fullName })
      .from(persons)
      .where(and(eq(persons.isPriority, true), eq(persons.isTracked, true), isNull(persons.mergedIntoId), ne(persons.status, "do_not_contact")));
    if (people.length === 0) return { checked: 0, raised: 0, toDraft: [] };
    const rows = await interactionRows(tx, people.map((p) => p.id));
    let raised = 0;
    const toDraft: string[] = [];
    for (const p of people) {
      const verdict = isGoingQuiet(rows.filter((r) => r.personId === p.id), now, scoring, quietDays);
      if (!verdict.quiet) continue;
      const [recent] = await tx.select({ id: signals.id }).from(signals).where(and(eq(signals.personId, p.id), eq(signals.type, "internal_relationship_quiet"), gte(signals.foundAt, new Date(now.getTime() - QUIET_REPEAT_DAYS * DAY)))).limit(1);
      if (recent) continue;
      const [open] = await tx.select({ id: actions.id }).from(actions).where(and(eq(actions.personId, p.id), eq(actions.type, "reengage"), inArray(actions.status, [...OPEN_STATUSES]))).limit(1);
      if (open) continue;
      const [signal] = await tx
        .insert(signals)
        .values({
          workspaceId, subjectType: "person", personId: p.id, type: "internal_relationship_quiet",
          headline: `${p.name}: no two-way contact for ${verdict.daysSilent} days`.slice(0, 140),
          foundAt: now, foundBy: "feed_rule", confidence: "high", priority: 2, lane: "auto_confirm", status: "confirmed", confirmedAt: now,
          dedupeKey: `${p.id}:internal_relationship_quiet:${now.toISOString().slice(0, 10)}`, eventOn: now.toISOString().slice(0, 10),
          explanation: { rule: `Warm or strong in the last ${QUIET_LOOKBACK_DAYS} days; no two-way touch for ${quietDays} days (BRD 11.5)` },
        })
        .returning();
      raised++;
      toDraft.push(...actionsToDraft(await createActionForSignal(tx, signal!, now)));
    }
    return { checked: people.length, raised, toDraft };
  });
}
