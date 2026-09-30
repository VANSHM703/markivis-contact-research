/** Read queries for the Actions screen and the action drawer (BRD 12.3, 16.2, design file 9.6). */
import { and, asc, count, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { actions, auditLog, companies, drafts, interactions, offLimits, persons, roles, signals, signalSources, users, workspaceMembers } from "@/db/schema";
import { OPEN_STATUSES } from "@/domain/actions";
import { evaluateChecks, loadCheckFacts, ruleActive, type CheckResult } from "@/domain/checks";
import { sentToday } from "@/domain/action-flow";
import { bandFor, firmBands, type BandInfo } from "@/domain/relationships";
import { endOfLocalDay, escalatesAt, localDate } from "@/lib/working-days";
import { UUID_RE } from "./guards";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export const STATUS_FILTERS = ["open", "awaiting_approval", "approved", "sent", "done", "dismissed", "all"] as const;
export const DUE_FILTERS = ["overdue", "today", "week"] as const;

export interface ActionFilters {
  owner: "me" | "all" | string;
  status: (typeof STATUS_FILTERS)[number];
  priority?: 1 | 2 | 3;
  type?: string;
  due?: (typeof DUE_FILTERS)[number];
}

export function parseActionFilters(params: Params): ActionFilters {
  const owner = one(params.owner);
  const status = one(params.status);
  const priority = Number(one(params.priority));
  const due = one(params.due);
  return {
    owner: owner === "all" || (owner && UUID_RE.test(owner)) ? owner : "me",
    status: STATUS_FILTERS.includes(status as ActionFilters["status"]) ? (status as ActionFilters["status"]) : "open",
    priority: [1, 2, 3].includes(priority) ? (priority as 1 | 2 | 3) : undefined,
    type: one(params.type)?.replace(/[^a-z_]/g, "") || undefined,
    due: DUE_FILTERS.includes(due as ActionFilters["due"] & string) ? (due as ActionFilters["due"]) : undefined,
  };
}

export interface ActionRow {
  id: string;
  status: string;
  type: string;
  dueAt: Date;
  escalated: boolean;
  overdue: boolean;
  headline: string;
  priority: number | null;
  personId: string | null;
  personName: string | null;
  roleTitle: string | null;
  companyName: string | null;
  ownerName: string;
  band: string | null;
  blocked: boolean;
  mergedCount: number;
}

const signalPriority = sql<number | null>`(select s.priority from dmi.signals s where s.id = ${actions.signalId})`;
const headlineSql = sql<string | null>`coalesce(${actions.headline}, (select s.headline from dmi.signals s where s.id = ${actions.signalId}))`;

export async function listActions(workspaceId: string, userId: string, timeZone: string, f: ActionFilters, page = 1, pageSize = 50, now = new Date()) {
  const clauses: (SQL | undefined)[] = [];
  if (f.owner === "me") clauses.push(eq(actions.ownerUserId, userId));
  else if (f.owner !== "all") clauses.push(eq(actions.ownerUserId, f.owner));
  if (f.status === "open") clauses.push(inArray(actions.status, [...OPEN_STATUSES]));
  else if (f.status !== "all") clauses.push(eq(actions.status, f.status));
  if (f.priority) clauses.push(sql`${signalPriority} = ${f.priority}`);
  if (f.type) clauses.push(sql`${actions.type}::text = ${f.type}`);
  if (f.due === "overdue") clauses.push(sql`${actions.dueAt} < ${now}`);
  if (f.due === "today") clauses.push(lte(actions.dueAt, endOfLocalDay(now, timeZone)));
  if (f.due === "week") clauses.push(lte(actions.dueAt, new Date(now.getTime() + 7 * 86_400_000)));
  const where = and(...clauses);
  return withWorkspace(workspaceId, async (tx) => {
    const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(actions).where(where);
    const rows = await tx
      .select({
        id: actions.id,
        status: actions.status,
        type: actions.type,
        dueAt: actions.dueAt,
        escalatedAt: actions.escalatedAt,
        headline: headlineSql,
        priority: signalPriority,
        personId: actions.personId,
        personName: persons.fullName,
        roleTitle: sql<string | null>`(select r.title from dmi.roles r where r.person_id = ${actions.personId} and r.is_primary)`,
        companyName: sql<string | null>`coalesce((select c.name from dmi.roles r join dmi.companies c on c.id = r.company_id where r.person_id = ${actions.personId} and r.is_primary), (select c.name from dmi.companies c where c.id = ${actions.companyId}))`,
        ownerName: users.name,
        blockedReason: actions.blockedReason,
        mergedCount: sql<number>`cardinality(${actions.mergedSignalIds})`,
      })
      .from(actions)
      .leftJoin(persons, eq(persons.id, actions.personId))
      .innerJoin(users, eq(users.id, actions.ownerUserId))
      .where(where)
      .orderBy(sql`${actions.escalatedAt} is null`, asc(actions.dueAt), sql`${signalPriority} nulls last`)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const bands = await firmBands(tx, rows.flatMap((r) => (r.personId ? [r.personId] : [])));
    const open = (s: string) => (OPEN_STATUSES as readonly string[]).includes(s);
    const list: ActionRow[] = rows.map((r) => ({
      id: r.id,
      status: r.status,
      type: r.type,
      dueAt: r.dueAt,
      escalated: open(r.status) && (!!r.escalatedAt || now >= escalatesAt(r.dueAt, timeZone)),
      overdue: open(r.status) && r.dueAt < now,
      headline: r.headline ?? "Action",
      priority: r.priority,
      personId: r.personId,
      personName: r.personName,
      roleTitle: r.roleTitle,
      companyName: r.companyName,
      ownerName: r.ownerName,
      band: r.personId ? (bands.get(r.personId) ?? null) : null,
      blocked: !!r.blockedReason && open(r.status),
      mergedCount: r.mergedCount,
    }));
    return { rows: list, total };
  });
}

export async function listOwners(workspaceId: string) {
  return withWorkspace(workspaceId, (tx) =>
    tx
      .select({ id: users.id, name: users.name, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.status, "active"), inArray(workspaceMembers.role, ["partner", "outreach_owner", "account_lead"])))
      .orderBy(asc(users.name)),
  );
}

// ---------------------------------------------------------------------------------------------
// The drawer
// ---------------------------------------------------------------------------------------------

export interface CardSignal {
  id: string;
  type: string;
  priority: number;
  headline: string;
  confirmedAt: Date | null;
  sources: { title: string | null; url: string | null; publishedAt: Date | null; sourceType: string }[];
}

export interface ActionDetail {
  action: typeof actions.$inferSelect;
  ownerName: string;
  person: { id: string; name: string; country: string | null; contactTypes: string[]; status: string; isOffList: boolean; linkedinUrl: string | null } | null;
  company: { id: string; name: string } | null;
  currentRole: { title: string; company: string } | null;
  previousRole: { title: string; company: string; endedOn: string | null } | null;
  signals: CardSignal[];
  companySignals: { headline: string; confirmedAt: Date | null }[];
  position: { band: BandInfo | null; lastTwoWay: { channel: string; at: Date } | null; offLimits: string[] };
  draft: (typeof drafts.$inferSelect) | null;
  versions: number;
  approvedByName: string | null;
  check: CheckResult | null;
  recipientEmail: string | null;
  sentToday: number;
  maxPerDay: number;
  history: { at: Date; action: string; actor: string | null; after: unknown }[];
  escalated: boolean;
}

export async function getActionDetail(workspaceId: string, actionId: string, timeZone: string, now = new Date()): Promise<ActionDetail | null> {
  if (!UUID_RE.test(actionId)) return null;
  return withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx.select({ action: actions, ownerName: users.name }).from(actions).innerJoin(users, eq(users.id, actions.ownerUserId)).where(eq(actions.id, actionId)).limit(1);
    if (!row) return null;
    const { action } = row;
    const [person] = action.personId ? await tx.select().from(persons).where(eq(persons.id, action.personId)).limit(1) : [];
    const personRoles = person
      ? await tx.select({ title: roles.title, company: companies.name, companyId: roles.companyId, status: roles.status, isPrimary: roles.isPrimary, endedOn: roles.endedOn, email: roles.businessEmail, emailStatus: roles.emailStatus }).from(roles).innerJoin(companies, eq(companies.id, roles.companyId)).where(eq(roles.personId, person.id)).orderBy(desc(roles.effectiveOn))
      : [];
    const primary = personRoles.find((r) => r.isPrimary) ?? personRoles.find((r) => r.status === "current") ?? null;
    const previous = personRoles.filter((r) => r.status === "ended").sort((a, b) => (b.endedOn ?? "").localeCompare(a.endedOn ?? ""))[0] ?? null;
    const [company] = action.companyId ? await tx.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, action.companyId)).limit(1) : [];

    const signalIds = [action.signalId, ...action.mergedSignalIds].filter((id): id is string => !!id);
    const signalRows = signalIds.length ? await tx.select().from(signals).where(inArray(signals.id, signalIds)) : [];
    const sourceRows = signalIds.length ? await tx.select().from(signalSources).where(inArray(signalSources.signalId, signalIds)).orderBy(asc(signalSources.publishedAt)) : [];
    const cardSignals: CardSignal[] = signalIds.flatMap((id) => {
      const s = signalRows.find((r) => r.id === id);
      if (!s) return [];
      return [{ id: s.id, type: s.type, priority: s.priority, headline: s.headline, confirmedAt: s.confirmedAt, sources: sourceRows.filter((x) => x.signalId === s.id).map((x) => ({ title: x.title, url: x.url, publishedAt: x.publishedAt, sourceType: x.sourceType })) }];
    });

    // Why it matters: plus any company signal in the last 30 days (BRD 12.3).
    const companyIds = Array.from(new Set([action.companyId, primary?.companyId].filter((id): id is string => !!id)));
    const companySignals = companyIds.length
      ? await tx
          .select({ headline: signals.headline, confirmedAt: signals.confirmedAt })
          .from(signals)
          .where(and(inArray(signals.companyId, companyIds), eq(signals.subjectType, "company"), eq(signals.status, "confirmed"), gte(signals.confirmedAt, new Date(now.getTime() - 30 * 86_400_000)), signalIds.length ? sql`${signals.id} not in (${sql.join(signalIds.map((id) => sql`${id}::uuid`), sql`, `)})` : undefined))
          .orderBy(desc(signals.confirmedAt))
          .limit(3)
      : [];

    // Our position: band, last two-way touch, off-limits (BRD 12.3).
    const band = person ? await bandFor(tx, person.id, action.ownerUserId) : null;
    const [twoWay] = person
      ? await tx.select({ channel: interactions.channel, at: interactions.occurredAt }).from(interactions).where(and(eq(interactions.personId, person.id), or(eq(interactions.direction, "two_way"), eq(interactions.direction, "inbound")))).orderBy(desc(interactions.occurredAt)).limit(1)
      : [];
    const today = localDate(now, timeZone);
    const currentCompanyIds = personRoles.filter((r) => r.status === "current").map((r) => r.companyId);
    const rules = currentCompanyIds.length ? await tx.select({ scope: offLimits.scope, fn: offLimits.function, minSeniority: offLimits.minSeniority, startsOn: offLimits.startsOn, endsOn: offLimits.endsOn, company: companies.name }).from(offLimits).innerJoin(companies, eq(companies.id, offLimits.companyId)).where(inArray(offLimits.companyId, currentCompanyIds)) : [];
    const offLimitsLines = rules
      .filter((r) => ruleActive(r, today))
      .map((r) => (r.scope === "company" ? `${r.company}: company-wide` : r.scope === "function" ? `${r.company}: ${r.fn ?? "one function"}` : `${r.company}: ${r.minSeniority?.replace("_", " ")} and above`));

    const [draft] = await tx.select().from(drafts).where(eq(drafts.actionId, actionId)).orderBy(desc(drafts.version)).limit(1);
    const [versions] = await tx.select({ n: count() }).from(drafts).where(eq(drafts.actionId, actionId));
    const [approver] = draft?.approvedBy ? await tx.select({ name: users.name }).from(users).where(eq(users.id, draft.approvedBy)).limit(1) : [];

    const facts = person ? await loadCheckFacts(tx, workspaceId, person.id) : null;
    const check = facts ? evaluateChecks(facts, action.purpose, today, draft?.channel) : null;
    const email = personRoles.filter((r) => (r.status === "current" || r.status === "announced") && r.email && r.emailStatus !== "invalid").sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))[0]?.email ?? null;

    const { settings } = (await tx.execute(sql`select settings from dmi.workspaces where id = ${workspaceId}`)).rows[0] as { settings: { send?: { max_per_day?: number } } };
    const history = await tx
      .select({ at: auditLog.at, action: auditLog.action, actor: users.name, after: auditLog.after })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(and(eq(auditLog.entityType, "action"), eq(auditLog.entityId, actionId)))
      .orderBy(desc(auditLog.at))
      .limit(30);
    const open = (OPEN_STATUSES as readonly string[]).includes(action.status);

    return {
      action,
      ownerName: row.ownerName,
      person: person ? { id: person.id, name: person.fullName, country: person.country, contactTypes: person.contactTypes, status: person.status, isOffList: person.isOffList, linkedinUrl: person.linkedinUrl } : null,
      company: company ?? null,
      currentRole: primary ? { title: primary.title, company: primary.company } : null,
      previousRole: previous ? { title: previous.title, company: previous.company, endedOn: previous.endedOn } : null,
      signals: cardSignals,
      companySignals,
      position: { band, lastTwoWay: twoWay ?? null, offLimits: offLimitsLines },
      draft: draft ?? null,
      versions: versions?.n ?? 0,
      approvedByName: approver?.name ?? null,
      check,
      recipientEmail: email,
      sentToday: draft?.approvedBy ? await sentToday(tx, draft.approvedBy, timeZone, now) : 0,
      maxPerDay: Number(settings.send?.max_per_day ?? 25),
      history,
      escalated: open && (!!action.escalatedAt || now >= escalatesAt(action.dueAt, timeZone)),
    };
  });
}
