/** Read queries for people and companies. Every function takes a workspace ID and runs scoped. */
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { companies, persons, placements, roles } from "@/db/schema";

export const PAGE_SIZE = 50;

export interface PersonRow {
  id: string;
  fullName: string;
  title: string | null;
  companyId: string | null;
  companyName: string | null;
  contactTypes: string[];
  status: "active" | "no_current_role" | "do_not_contact";
  isOffList: boolean;
  isPlaced: boolean;
  country: string | null;
}

export async function listPeople(workspaceId: string, page = 1): Promise<{ rows: PersonRow[]; total: number }> {
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  return withWorkspace(workspaceId, async (tx) => {
    const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(persons).where(isNull(persons.mergedIntoId));
    const rows = await tx
      .select({
        id: persons.id,
        fullName: persons.fullName,
        title: roles.title,
        companyId: companies.id,
        companyName: companies.name,
        contactTypes: persons.contactTypes,
        status: persons.status,
        isOffList: persons.isOffList,
        country: persons.country,
        // Correlated subqueries use explicit aliases: Drizzle renders bare column names inside raw SQL.
        isPlaced: sql<boolean>`exists (select 1 from ${placements} pl where pl.person_id = ${persons}.id)`,
      })
      .from(persons)
      .leftJoin(roles, and(eq(roles.personId, persons.id), eq(roles.isPrimary, true)))
      .leftJoin(companies, eq(companies.id, roles.companyId))
      .where(isNull(persons.mergedIntoId))
      .orderBy(asc(persons.nameNormalised))
      .limit(PAGE_SIZE)
      .offset(offset);
    return { rows, total };
  });
}

export async function getPerson(workspaceId: string, personId: string) {
  return withWorkspace(workspaceId, async (tx) => {
    const [person] = await tx.select().from(persons).where(eq(persons.id, personId)).limit(1);
    if (!person) return null;
    const personRoles = await tx
      .select({ role: roles, companyName: companies.name })
      .from(roles)
      .innerJoin(companies, eq(companies.id, roles.companyId))
      .where(eq(roles.personId, personId))
      .orderBy(sql`${roles.effectiveOn} desc nulls last`);
    return { person, roles: personRoles.map((r) => ({ ...r.role, companyName: r.companyName })) };
  });
}

export interface CompanyRow {
  id: string;
  name: string;
  targetTier: number | null;
  ownership: string;
  clientStatus: string;
  isSponsor: boolean;
  industry: string | null;
  peopleCount: number;
}

export async function listCompanies(workspaceId: string, page = 1): Promise<{ rows: CompanyRow[]; total: number }> {
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  return withWorkspace(workspaceId, async (tx) => {
    const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(companies);
    const rows = await tx
      .select({
        id: companies.id,
        name: companies.name,
        targetTier: companies.targetTier,
        ownership: companies.ownership,
        clientStatus: companies.clientStatus,
        isSponsor: companies.isSponsor,
        industry: companies.industry,
        peopleCount: sql<number>`(select count(distinct r.person_id)::int from ${roles} r where r.company_id = ${companies}.id and r.status = 'current')`,
      })
      .from(companies)
      .orderBy(sql`${companies.targetTier} asc nulls last`, asc(companies.nameNormalised))
      .limit(PAGE_SIZE)
      .offset(offset);
    return { rows, total };
  });
}

export async function getCompany(workspaceId: string, companyId: string) {
  return withWorkspace(workspaceId, async (tx) => {
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company) return null;
    const seats = await tx
      .select({ roleId: roles.id, title: roles.title, seatType: roles.seatType, personId: persons.id, fullName: persons.fullName })
      .from(roles)
      .innerJoin(persons, eq(persons.id, roles.personId))
      .where(and(eq(roles.companyId, companyId), inArray(roles.status, ["current", "announced"])))
      .orderBy(asc(roles.seatType), asc(roles.title));
    return { company, seats };
  });
}
