/**
 * Identity resolution (BRD 7.1 and 7.2). Never merges two people on name alone.
 *
 *   1  exact canonical LinkedIn URL                       same person
 *   2  exact business email on any role (not invalid)     same person
 *   3  same name and a matching role                      same person, auto-linked and logged
 *   4  same name and same company or same city only       possible duplicate: queue item, never merged
 *   5  no match                                           new person (after the suppression check)
 */
import { and, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { companies, persons, roles } from "@/db/schema";
import { canonicalLinkedinUrl, normaliseCik, normaliseCompanyName, normaliseDomain, normaliseEmail, normaliseName } from "@/lib/normalise";
import { normaliseTitle } from "./titles";

export interface CompanyReference {
  name?: string | null;
  domain?: string | null;
  secCik?: string | null;
  ticker?: string | null;
}

/** Resolves a company by domain, then CIK, then normalised name, then aliases (BRD 7.2). */
export async function resolveCompany(tx: Tx, ref: CompanyReference): Promise<string | null> {
  const domain = normaliseDomain(ref.domain);
  if (domain) {
    const [row] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.domain, domain)).limit(1);
    if (row) return row.id;
  }
  const cik = normaliseCik(ref.secCik);
  if (cik) {
    const [row] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.secCik, cik)).limit(1);
    if (row) return row.id;
  }
  const name = ref.name ? normaliseCompanyName(ref.name) : "";
  if (name) {
    const [row] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.nameNormalised, name)).limit(1);
    if (row) return row.id;
  }
  const aliases = [ref.name?.trim(), ref.ticker?.trim()].filter((v): v is string => !!v);
  for (const alias of aliases) {
    const [row] = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(sql`exists (select 1 from unnest(${companies.aliases}) a where lower(a) = lower(${alias}))`)
      .limit(1);
    if (row) return row.id;
  }
  return null;
}

export interface RoleReference {
  companyId: string | null;
  title?: string | null;
  effectiveOn?: string | null;
  endedOn?: string | null;
}

export interface PersonReference {
  fullName: string;
  linkedinUrl?: string | null;
  emails?: (string | null | undefined)[];
  city?: string | null;
  role?: RoleReference | null;
  /** Ignore this person (for example when re-checking an existing record). */
  excludePersonId?: string;
}

export type PersonMatch =
  | { kind: "same"; personId: string; step: 1 | 2 | 3 }
  | { kind: "possible_duplicate"; candidateIds: string[] }
  | { kind: "new" };

type DateRange = { from: string | null; to: string | null };

/** Two date ranges overlap. An open start or end is treated as unbounded. */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  const aFrom = a.from ?? "0000-01-01";
  const aTo = a.to ?? "9999-12-31";
  const bFrom = b.from ?? "0000-01-01";
  const bTo = b.to ?? "9999-12-31";
  return aFrom <= bTo && bFrom <= aTo;
}

export async function matchPerson(tx: Tx, ref: PersonReference): Promise<PersonMatch> {
  const live = and(isNull(persons.mergedIntoId), ref.excludePersonId ? ne(persons.id, ref.excludePersonId) : undefined);

  // Step 1: canonical LinkedIn URL.
  const linkedin = canonicalLinkedinUrl(ref.linkedinUrl);
  if (linkedin) {
    const [row] = await tx.select({ id: persons.id }).from(persons).where(and(live, eq(persons.linkedinUrl, linkedin))).limit(1);
    if (row) return { kind: "same", personId: row.id, step: 1 };
  }

  // Step 2: business email on any past or current role that is not invalid.
  const emails = (ref.emails ?? []).map((e) => normaliseEmail(e)).filter((e): e is string => !!e);
  if (emails.length > 0) {
    const rows = await tx
      .selectDistinct({ id: persons.id })
      .from(roles)
      .innerJoin(persons, eq(persons.id, roles.personId))
      .where(and(live, inArray(roles.businessEmail, emails), ne(roles.emailStatus, "invalid")));
    if (rows.length === 1) return { kind: "same", personId: rows[0]!.id, step: 2 };
    if (rows.length > 1) return { kind: "possible_duplicate", candidateIds: rows.map((r) => r.id) };
  }

  // Steps 3 and 4 start from people with the same normalised name.
  const name = normaliseName(ref.fullName);
  if (!name) return { kind: "new" };
  const sameName = await tx.select({ id: persons.id, city: persons.city }).from(persons).where(and(live, eq(persons.nameNormalised, name)));
  if (sameName.length === 0) return { kind: "new" };

  const ids = sameName.map((p) => p.id);
  const candidateRoles = await tx
    .select({ personId: roles.personId, companyId: roles.companyId, titleNormalised: roles.titleNormalised, effectiveOn: roles.effectiveOn, endedOn: roles.endedOn })
    .from(roles)
    .where(inArray(roles.personId, ids));

  const role = ref.role;
  const title = role?.title ? normaliseTitle(role.title).titleNormalised : null;

  // Step 3: same name and at least one matching role (same company, and same title or overlapping dates).
  if (role?.companyId) {
    const matched = new Set(
      candidateRoles
        .filter((r) => r.companyId === role.companyId)
        .filter((r) => (title !== null && r.titleNormalised === title) || rangesOverlap({ from: r.effectiveOn, to: r.endedOn }, { from: role.effectiveOn ?? null, to: role.endedOn ?? null }))
        .map((r) => r.personId),
    );
    if (matched.size === 1) return { kind: "same", personId: [...matched][0]!, step: 3 };
    if (matched.size > 1) return { kind: "possible_duplicate", candidateIds: [...matched] };
  }

  // Step 4: same name and same company or same city only.
  const city = ref.city?.trim().toLowerCase();
  const possible = sameName
    .filter((p) => (role?.companyId && candidateRoles.some((r) => r.personId === p.id && r.companyId === role.companyId)) || (city && p.city?.trim().toLowerCase() === city))
    .map((p) => p.id);
  if (possible.length > 0) return { kind: "possible_duplicate", candidateIds: possible };

  return { kind: "new" };
}

/** Companies whose name resembles the query, for the company picker and global search. */
export async function searchCompanies(tx: Tx, query: string, limit = 10) {
  const q = normaliseCompanyName(query);
  if (!q) return [];
  return tx
    .select({ id: companies.id, name: companies.name, domain: companies.domain, industry: companies.industry })
    .from(companies)
    .where(or(ilike(companies.nameNormalised, `%${q}%`), sql`${companies.nameNormalised} % ${q}`, ilike(companies.domain, `%${q.replace(/\s+/g, "")}%`)))
    .orderBy(sql`similarity(${companies.nameNormalised}, ${q}) desc`, companies.name)
    .limit(limit);
}

/** People whose name resembles the query. */
export async function searchPeople(tx: Tx, query: string, limit = 10) {
  const q = normaliseName(query);
  if (!q) return [];
  return tx
    .select({ id: persons.id, fullName: persons.fullName, title: roles.title, companyName: companies.name })
    .from(persons)
    .leftJoin(roles, and(eq(roles.personId, persons.id), eq(roles.isPrimary, true)))
    .leftJoin(companies, eq(companies.id, roles.companyId))
    .where(and(isNull(persons.mergedIntoId), or(ilike(persons.nameNormalised, `%${q}%`), sql`${persons.nameNormalised} % ${q}`)))
    .orderBy(sql`similarity(${persons.nameNormalised}, ${q}) desc`, persons.fullName)
    .limit(limit);
}
