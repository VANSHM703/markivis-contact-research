/** Read queries for scores, connections, paths, coverage and calibration (BRD 11.4 to 11.8, 16.2). */
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { companies, interactions, persons, relationshipScores, roles, users } from "@/db/schema";
import { connectionsOf } from "@/domain/connections";
import { findPaths } from "@/domain/paths";
import { interactionRows } from "@/domain/relationships";
import { computeScore, scoringSettings, spearman, type Factors, type ScoringSettings } from "@/domain/scoring";
import type { RequestContext } from "@/lib/context";
import { localDate } from "@/lib/working-days";

export async function personRelationship(ctx: RequestContext, personId: string) {
  const today = localDate(new Date(), ctx.workspace.timezone);
  return withWorkspace(ctx.workspace.id, async (tx) => {
    const [firm] = await tx.select().from(relationshipScores).where(and(eq(relationshipScores.personId, personId), isNull(relationshipScores.userId))).limit(1);
    const byUser = await tx
      .select({ name: users.name, score: relationshipScores.score, band: relationshipScores.band })
      .from(relationshipScores)
      .innerJoin(users, eq(users.id, relationshipScores.userId))
      .where(and(eq(relationshipScores.personId, personId), isNotNull(relationshipScores.userId)))
      .orderBy(desc(relationshipScores.score));
    return {
      firm: firm ? { score: firm.score, band: firm.band, factors: firm.factors as Factors, lastTwoWayAt: firm.lastTwoWayAt, computedAt: firm.computedAt } : null,
      byUser,
      paths: ctx.workspace.flags["rel.paths"] === false ? [] : await findPaths(tx, personId, today),
      connections: await connectionsOf(tx, personId),
    };
  });
}

export async function pathsFor(ctx: RequestContext, personId: string) {
  const today = localDate(new Date(), ctx.workspace.timezone);
  return withWorkspace(ctx.workspace.id, async (tx) => {
    const [target] = await tx
      .select({ id: persons.id, name: persons.fullName, title: roles.title, company: companies.name })
      .from(persons)
      .leftJoin(roles, and(eq(roles.personId, persons.id), eq(roles.isPrimary, true)))
      .leftJoin(companies, eq(companies.id, roles.companyId))
      .where(eq(persons.id, personId))
      .limit(1);
    if (!target) return null;
    return { target, paths: await findPaths(tx, personId, today) };
  });
}

// ---------------------------------------------------------------------------------------------
// Coverage (BRD 11.8)
// ---------------------------------------------------------------------------------------------

export const SEATS = ["CEO", "CFO", "CHRO", "COO", "CTO or CIO", "Chair", "Other board"] as const;
export type Seat = (typeof SEATS)[number];

const SEAT_TITLES: Record<Seat, string> = { CEO: "Chief Executive Officer", CFO: "Chief Financial Officer", CHRO: "Chief Human Resources Officer", COO: "Chief Operating Officer", "CTO or CIO": "Chief Technology Officer", Chair: "Chair", "Other board": "Independent Director" };
export const seatTitle = (seat: Seat) => SEAT_TITLES[seat];

export function seatOf(titleNormalised: string | null, seatType: string): Seat | null {
  if (titleNormalised === "CEO") return "CEO";
  if (titleNormalised === "CFO") return "CFO";
  if (titleNormalised === "CHRO") return "CHRO";
  if (titleNormalised === "COO") return "COO";
  if (titleNormalised === "CTO" || titleNormalised === "CIO") return "CTO or CIO";
  if (titleNormalised === "Chair") return "Chair";
  if (seatType === "board") return "Other board";
  return null;
}

export interface CoverageFilters {
  tier?: 1 | 2 | 3;
  industry?: string;
  ownership?: string;
}

export async function coverage(ctx: RequestContext, f: CoverageFilters) {
  return withWorkspace(ctx.workspace.id, async (tx) => {
    const clauses: (SQL | undefined)[] = [isNotNull(companies.targetTier), eq(companies.isSponsor, false)];
    if (f.tier) clauses.push(eq(companies.targetTier, f.tier));
    if (f.industry) clauses.push(eq(companies.industry, f.industry));
    if (f.ownership) clauses.push(sql`${companies.ownership}::text = ${f.ownership}`);
    const rows = await tx.select({ id: companies.id, name: companies.name, tier: companies.targetTier }).from(companies).where(and(...clauses)).orderBy(asc(companies.targetTier), asc(companies.name));
    const industries = (await tx.selectDistinct({ i: companies.industry }).from(companies).where(isNotNull(companies.targetTier))).map((r) => r.i).filter((i): i is string => !!i).sort();
    const seats = rows.length
      ? await tx
          .select({ companyId: roles.companyId, personId: roles.personId, name: persons.fullName, title: roles.titleNormalised, seatType: roles.seatType, band: relationshipScores.band })
          .from(roles)
          .innerJoin(persons, eq(persons.id, roles.personId))
          .leftJoin(relationshipScores, and(eq(relationshipScores.personId, roles.personId), isNull(relationshipScores.userId)))
          .where(and(inArray(roles.companyId, rows.map((r) => r.id)), eq(roles.status, "current"), isNull(persons.mergedIntoId)))
      : [];
    return {
      industries,
      rows: rows.map((c) => ({
        ...c,
        cells: Object.fromEntries(SEATS.map((seat) => [seat, seats.filter((s) => s.companyId === c.id && seatOf(s.title, s.seatType) === seat).map((s) => ({ personId: s.personId, name: s.name, band: s.band ?? "none" }))])) as Record<Seat, { personId: string; name: string; band: string }[]>,
      })),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Calibration (BRD 11.4)
// ---------------------------------------------------------------------------------------------

export const CALIBRATION_SIZE = 30;

/**
 * The 30 people the partner is most likely to know well (most interactions with them), in name
 * order so nothing hints at their scores, and the rank correlation for a set of weights.
 */
export async function calibration(ctx: RequestContext, candidate?: ScoringSettings["weights"]) {
  return withWorkspace(ctx.workspace.id, async (tx) => {
    const top = await tx
      .select({ id: persons.id, name: persons.fullName, n: count(interactions.id) })
      .from(persons)
      .innerJoin(interactions, and(eq(interactions.personId, persons.id), eq(interactions.ourUserId, ctx.user.id)))
      .where(and(isNull(persons.mergedIntoId), eq(persons.isTracked, true)))
      .groupBy(persons.id, persons.fullName)
      .orderBy(desc(count(interactions.id)), asc(persons.fullName))
      .limit(CALIBRATION_SIZE);
    const people = [...top].sort((a, b) => a.name.localeCompare(b.name));
    const settings = scoringSettings(ctx.workspace.settings);
    const stored = ((ctx.workspace.settings.scoring as { calibration?: { ranks: Record<string, number>; at: string } } | undefined)?.calibration) ?? null;
    let correlation: number | null = null;
    let candidateCorrelation: number | null = null;
    if (stored && people.length) {
      const ranked = people.filter((p) => stored.ranks[p.id]);
      const rows = await interactionRows(tx, ranked.map((p) => p.id));
      const scoreWith = (weights: ScoringSettings["weights"]) => ranked.map((p) => computeScore(rows.filter((r) => r.personId === p.id), new Date(), { ...settings, weights }).score);
      // Rank 1 is the strongest relationship, so compare against the negative rank.
      const partner = ranked.map((p) => -stored.ranks[p.id]!);
      if (ranked.length >= 5) {
        correlation = spearman(partner, scoreWith(settings.weights));
        if (candidate) candidateCorrelation = spearman(partner, scoreWith(candidate));
      }
    }
    return { people, stored, correlation, candidateCorrelation, settings };
  });
}
