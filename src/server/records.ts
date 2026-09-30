/** Read queries for people and companies. Every function takes a workspace ID and runs scoped. */
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { actions, auditLog, companies, fieldSources, offLimits, persons, placements, queueItems, roles, users } from "@/db/schema";
import { reversibleMerge } from "@/domain/merge";
import { offLimitsCoversSql } from "@/domain/off-limits";
import { placementsFor } from "@/domain/placements";
import { normaliseCompanyName, normaliseName } from "@/lib/normalise";

export const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------------------------
// Filters (BRD 16.3). Reflected in the URL so views can be bookmarked and shared.
// ---------------------------------------------------------------------------------------------

export interface PeopleFilters {
  q?: string;
  contactType?: string;
  tier?: 1 | 2 | 3;
  ownership?: string;
  seatType?: string;
  flag?: "placed" | "off_limits" | "do_not_contact" | "off_list" | "no_current_role" | "priority";
  companyId?: string;
}

export interface CompanyFilters {
  q?: string;
  tier?: 1 | 2 | 3;
  ownership?: string;
  clientStatus?: string;
  sponsor?: boolean;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tierOf = (v?: string) => (v === "1" || v === "2" || v === "3" ? (Number(v) as 1 | 2 | 3) : undefined);

export function parsePeopleFilters(params: Params): PeopleFilters {
  const flag = one(params.flag);
  const company = one(params.company);
  return {
    q: one(params.q)?.slice(0, 100),
    contactType: ["prospective_client", "potential_candidate", "referrer", "sponsor_contact"].find((t) => t === one(params.contact_type)),
    tier: tierOf(one(params.tier)),
    ownership: ["public", "pe_backed", "vc_backed", "private", "non_profit", "unknown"].find((o) => o === one(params.ownership)),
    seatType: ["executive", "board", "advisory", "pe_operating_partner", "pe_deal_partner", "other"].find((t) => t === one(params.seat_type)),
    flag: (["placed", "off_limits", "do_not_contact", "off_list", "no_current_role", "priority"] as const).find((f) => f === flag),
    companyId: company && UUID_RE.test(company) ? company : undefined,
  };
}

export function parseCompanyFilters(params: Params): CompanyFilters {
  return {
    q: one(params.q)?.slice(0, 100),
    tier: tierOf(one(params.tier)),
    ownership: ["public", "pe_backed", "vc_backed", "private", "non_profit", "unknown"].find((o) => o === one(params.ownership)),
    clientStatus: ["client", "prospect", "none"].find((c) => c === one(params.client_status)),
    sponsor: one(params.sponsor) === "yes" ? true : undefined,
  };
}

/** The filters as query-string pairs, for pagination links. */
export function filterQuery(params: Params, keys: string[]): string {
  const pairs = keys.flatMap((k) => {
    const v = one(params[k]);
    return v ? [`${encodeURIComponent(k)}=${encodeURIComponent(v)}`] : [];
  });
  return pairs.join("&");
}

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------

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
  isOffLimits: boolean;
  isPriority: boolean;
  country: string | null;
}

function peopleWhere(f: PeopleFilters, today: string): SQL | undefined {
  const clauses: (SQL | undefined)[] = [isNull(persons.mergedIntoId)];
  if (f.q) {
    const q = normaliseName(f.q);
    clauses.push(or(ilike(persons.nameNormalised, `%${q}%`), sql`${persons.nameNormalised} % ${q}`, ilike(companies.name, `%${f.q}%`)));
  }
  if (f.contactType) clauses.push(sql`${f.contactType} = any(${persons.contactTypes})`);
  if (f.tier) clauses.push(eq(companies.targetTier, f.tier));
  if (f.ownership) clauses.push(sql`${companies.ownership} = ${f.ownership}`);
  if (f.seatType) clauses.push(sql`exists (select 1 from ${roles} r where r.person_id = ${persons}.id and r.status = 'current' and r.seat_type = ${f.seatType})`);
  if (f.companyId) clauses.push(sql`exists (select 1 from ${roles} r where r.person_id = ${persons}.id and r.company_id = ${f.companyId})`);
  if (f.flag === "placed") clauses.push(sql`exists (select 1 from ${placements} pl where pl.person_id = ${persons}.id)`);
  if (f.flag === "off_limits") clauses.push(offLimitsCoversSql(sql`${persons}.id`, today));
  if (f.flag === "do_not_contact") clauses.push(eq(persons.status, "do_not_contact"));
  if (f.flag === "no_current_role") clauses.push(eq(persons.status, "no_current_role"));
  if (f.flag === "off_list") clauses.push(eq(persons.isOffList, true));
  if (f.flag === "priority") clauses.push(eq(persons.isPriority, true));
  return and(...clauses);
}

export async function listPeople(workspaceId: string, page = 1, filters: PeopleFilters = {}, today = new Date().toISOString().slice(0, 10)): Promise<{ rows: PersonRow[]; total: number }> {
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  const where = peopleWhere(filters, today);
  return withWorkspace(workspaceId, async (tx) => {
    const base = tx
      .select({ total: count() })
      .from(persons)
      .leftJoin(roles, and(eq(roles.personId, persons.id), eq(roles.isPrimary, true)))
      .leftJoin(companies, eq(companies.id, roles.companyId));
    const [{ total } = { total: 0 }] = await base.where(where);
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
        isPriority: persons.isPriority,
        country: persons.country,
        // Correlated subqueries use explicit aliases: Drizzle renders bare column names inside raw SQL.
        isPlaced: sql<boolean>`exists (select 1 from ${placements} pl where pl.person_id = ${persons}.id)`,
        isOffLimits: sql<boolean>`${offLimitsCoversSql(sql`${persons}.id`, today)}`,
      })
      .from(persons)
      .leftJoin(roles, and(eq(roles.personId, persons.id), eq(roles.isPrimary, true)))
      .leftJoin(companies, eq(companies.id, roles.companyId))
      .where(where)
      .orderBy(...(filters.q ? [sql`similarity(${persons.nameNormalised}, ${normaliseName(filters.q)}) desc`] : []), asc(persons.nameNormalised))
      .limit(PAGE_SIZE)
      .offset(offset);
    return { rows, total };
  });
}

export async function getPerson(workspaceId: string, personId: string, today = new Date().toISOString().slice(0, 10)) {
  return withWorkspace(workspaceId, async (tx) => {
    const [person] = await tx.select().from(persons).where(eq(persons.id, personId)).limit(1);
    if (!person) return null;
    const [{ covered } = { covered: false }] = await tx.select({ covered: offLimitsCoversSql(sql`${personId}::uuid`, today) }).from(sql`(select 1) as one`);
    const placementRows = await placementsFor(tx, { personId });
    const personRoles = await tx
      .select({ role: roles, companyName: companies.name })
      .from(roles)
      .innerJoin(companies, eq(companies.id, roles.companyId))
      .where(eq(roles.personId, personId))
      .orderBy(sql`${roles.status} = 'ended'`, sql`${roles.effectiveOn} desc nulls last`);
    const [placement] = await tx.select().from(placements).where(eq(placements.personId, personId)).limit(1);
    const mergedInto = person.mergedIntoId
      ? (await tx.select({ id: persons.id, fullName: persons.fullName }).from(persons).where(eq(persons.id, person.mergedIntoId)).limit(1))[0] ?? null
      : null;
    const merge = person.mergedIntoId ? await reversibleMerge(tx, personId) : null;
    const [owner] = person.relationshipOwnerId
      ? await tx.select({ name: users.name }).from(users).where(eq(users.id, person.relationshipOwnerId)).limit(1)
      : [];
    const duplicates = await tx
      .select({ id: queueItems.id })
      .from(queueItems)
      .where(and(eq(queueItems.kind, "possible_duplicate"), eq(queueItems.status, "pending"), sql`${queueItems.payload}->'person_ids' ? ${personId}`));
    const openActions = await tx
      .select({ id: actions.id, type: actions.type, status: actions.status, dueAt: actions.dueAt, headline: sql<string | null>`coalesce(${actions.headline}, (select s.headline from dmi.signals s where s.id = ${actions.signalId}))`, blockedReason: actions.blockedReason })
      .from(actions)
      .where(and(eq(actions.personId, personId), inArray(actions.status, ["open", "drafted", "awaiting_approval", "approved", "sent"])))
      .orderBy(actions.dueAt);
    return {
      person,
      openActions,
      isOffLimits: covered as boolean,
      placements: placementRows,
      roles: personRoles.map((r) => ({ ...r.role, companyName: r.companyName })),
      placement: placement ?? null,
      mergedInto,
      canUnmergeUntil: merge ? new Date(merge.at.getTime() + 90 * 86_400_000) : null,
      ownerName: owner?.name ?? null,
      pendingDuplicates: duplicates.length,
    };
  });
}

/** Every provenance row for a person and their roles, for the Record tab (BRD 16.2). */
export async function getPersonProvenance(workspaceId: string, personId: string) {
  return withWorkspace(workspaceId, async (tx) => {
    const roleRows = await tx.select({ id: roles.id, title: roles.title, companyName: companies.name }).from(roles).innerJoin(companies, eq(companies.id, roles.companyId)).where(eq(roles.personId, personId));
    const ids = [personId, ...roleRows.map((r) => r.id)];
    const sources = await tx
      .select()
      .from(fieldSources)
      .where(inArray(fieldSources.entityId, ids))
      .orderBy(asc(fieldSources.entityType), asc(fieldSources.field), desc(fieldSources.isCurrent), desc(fieldSources.capturedAt));
    const history = await tx
      .select({ action: auditLog.action, at: auditLog.at, actorName: users.name, after: auditLog.after })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(and(inArray(auditLog.entityId, ids), sql`(${auditLog.action} like 'person.%' or ${auditLog.action} like 'role.%')`))
      .orderBy(desc(auditLog.at))
      .limit(50);
    return { roleRows, sources, history };
  });
}

// ---------------------------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------------------------

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

function companyWhere(f: CompanyFilters): SQL | undefined {
  const clauses: (SQL | undefined)[] = [];
  if (f.q) {
    const q = normaliseCompanyName(f.q);
    clauses.push(or(ilike(companies.nameNormalised, `%${q}%`), sql`${companies.nameNormalised} % ${q}`, ilike(companies.domain, `%${f.q.trim()}%`), sql`exists (select 1 from unnest(${companies.aliases}) a where lower(a) = lower(${f.q.trim()}))`));
  }
  if (f.tier) clauses.push(eq(companies.targetTier, f.tier));
  if (f.ownership) clauses.push(sql`${companies.ownership} = ${f.ownership}`);
  if (f.clientStatus) clauses.push(sql`${companies.clientStatus} = ${f.clientStatus}`);
  if (f.sponsor) clauses.push(eq(companies.isSponsor, true));
  return clauses.length ? and(...clauses) : undefined;
}

export async function listCompanies(workspaceId: string, page = 1, filters: CompanyFilters = {}): Promise<{ rows: CompanyRow[]; total: number }> {
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  const where = companyWhere(filters);
  return withWorkspace(workspaceId, async (tx) => {
    const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(companies).where(where);
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
      .where(where)
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
      .select({ roleId: roles.id, title: roles.title, seatType: roles.seatType, status: roles.status, effectiveOn: roles.effectiveOn, personId: persons.id, fullName: persons.fullName })
      .from(roles)
      .innerJoin(persons, eq(persons.id, roles.personId))
      .where(and(eq(roles.companyId, companyId), inArray(roles.status, ["current", "announced"]), isNull(persons.mergedIntoId)))
      .orderBy(sql`${roles.seatType} = 'board'`, asc(roles.title));
    const rules = await tx.select().from(offLimits).where(eq(offLimits.companyId, companyId));
    return { company, seats, offLimits: rules, placements: await placementsFor(tx, { companyId }) };
  });
}

// ---------------------------------------------------------------------------------------------
// Queue: conflicts and duplicates (BRD 10.4)
// ---------------------------------------------------------------------------------------------

export async function listRecordQueueItems(workspaceId: string) {
  return withWorkspace(workspaceId, async (tx) => {
    const items = await tx.select().from(queueItems).where(eq(queueItems.status, "pending")).orderBy(asc(queueItems.createdAt)).limit(100);
    const personIds = new Set<string>();
    const sourceIds = new Set<string>();
    for (const item of items) {
      const p = item.payload as { person_ids?: string[]; field_source_ids?: string[]; entity_type?: string; entity_id?: string };
      p.person_ids?.forEach((id) => personIds.add(id));
      p.field_source_ids?.forEach((id) => sourceIds.add(id));
      if (p.entity_type === "person" && p.entity_id) personIds.add(p.entity_id);
    }
    const people = personIds.size
      ? await tx
          .select({ id: persons.id, fullName: persons.fullName, city: persons.city, linkedinUrl: persons.linkedinUrl, createdAt: persons.createdAt, title: roles.title, companyName: companies.name })
          .from(persons)
          .leftJoin(roles, and(eq(roles.personId, persons.id), eq(roles.isPrimary, true)))
          .leftJoin(companies, eq(companies.id, roles.companyId))
          .where(inArray(persons.id, [...personIds]))
      : [];
    const sources = sourceIds.size ? await tx.select().from(fieldSources).where(inArray(fieldSources.id, [...sourceIds])) : [];
    // Name the record each conflict is about.
    const roleIds = items.map((i) => i.payload as { entity_type?: string; entity_id?: string }).filter((p) => p.entity_type === "role").map((p) => p.entity_id!);
    const companyIds = items.map((i) => i.payload as { entity_type?: string; entity_id?: string }).filter((p) => p.entity_type === "company").map((p) => p.entity_id!);
    const roleNames = roleIds.length
      ? await tx.select({ id: roles.id, personId: roles.personId, fullName: persons.fullName, title: roles.title, companyName: companies.name }).from(roles).innerJoin(persons, eq(persons.id, roles.personId)).innerJoin(companies, eq(companies.id, roles.companyId)).where(inArray(roles.id, roleIds))
      : [];
    const companyNames = companyIds.length ? await tx.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, companyIds)) : [];
    return { items, people, sources, roleNames, companyNames };
  });
}
