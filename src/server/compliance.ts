/** Page data for the compliance and administration screens (BRD 16 Settings, 18). */
import { and, count, desc, eq, gte, ilike, sql, type SQL } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { actions, auditLog, consents, persons, roles, signals, users } from "@/db/schema";
import { checkSuppression, suppressionCounts } from "@/domain/consent";
import { previewErasure } from "@/domain/erasure";
import { retentionCandidates } from "@/domain/retention";
import { basePriority, priorityOverrides, SIGNAL_RULES } from "@/pipeline/rules";

export async function getPrivacyTab(workspaceId: string, personId: string) {
  return withWorkspace(workspaceId, async (tx) => {
    const [person] = await tx.select({ id: persons.id, fullName: persons.fullName, status: persons.status, linkedinUrl: persons.linkedinUrl, country: persons.country }).from(persons).where(eq(persons.id, personId)).limit(1);
    if (!person) return null;
    const consentRows = await tx
      .select({ id: consents.id, channel: consents.channel, purpose: consents.purpose, status: consents.status, jurisdiction: consents.jurisdiction, proof: consents.proof, capturedVia: consents.capturedVia, recordedAt: consents.recordedAt, recordedBy: users.name })
      .from(consents)
      .leftJoin(users, eq(users.id, consents.recordedBy))
      .where(eq(consents.personId, personId))
      .orderBy(consents.channel, consents.purpose);
    const emails = Array.from(new Set((await tx.select({ email: roles.businessEmail }).from(roles).where(eq(roles.personId, personId))).map((r) => r.email).filter((e): e is string => !!e)));
    const identifiers = [];
    for (const email of emails) identifiers.push({ label: email, reason: (await checkSuppression(tx, workspaceId, email))?.reason ?? null });
    if (person.linkedinUrl) identifiers.push({ label: "LinkedIn profile", reason: (await checkSuppression(tx, workspaceId, person.linkedinUrl))?.reason ?? null });
    return { person, consents: consentRows, identifiers, preview: await previewErasure(tx, personId) };
  });
}

export async function getSuppressionOverview(workspaceId: string) {
  return withWorkspace(workspaceId, (tx) => suppressionCounts(tx));
}

export async function getRetentionReview(workspaceId: string, now = new Date()) {
  return withWorkspace(workspaceId, (tx) => retentionCandidates(tx, now));
}

// ---------------------------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------------------------

export interface AuditFilters {
  action?: string;
  actor?: string;
  entity?: string;
  /** Entries from the last this many days. */
  days?: number;
}

export const AUDIT_PAGE_SIZE = 50;

export async function listAuditLog(workspaceId: string, filters: AuditFilters, page: number, now = new Date()) {
  return withWorkspace(workspaceId, async (tx) => {
    const clauses: (SQL | undefined)[] = [];
    if (filters.action) clauses.push(ilike(auditLog.action, `${filters.action.replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
    if (filters.actor === "system") clauses.push(eq(auditLog.actorKind, "system"));
    else if (filters.actor === "platform_admin") clauses.push(eq(auditLog.actorKind, "platform_admin"));
    else if (filters.actor && /^[0-9a-f-]{36}$/i.test(filters.actor)) clauses.push(eq(auditLog.actorUserId, filters.actor));
    if (filters.entity) clauses.push(eq(auditLog.entityType, filters.entity));
    if (filters.days) clauses.push(gte(auditLog.at, new Date(now.getTime() - filters.days * 86_400_000)));
    const where = clauses.length ? and(...clauses) : undefined;
    const [{ n }] = (await tx.select({ n: count() }).from(auditLog).where(where)) as [{ n: number }];
    const rows = await tx
      .select({ id: auditLog.id, at: auditLog.at, action: auditLog.action, actorKind: auditLog.actorKind, actorName: users.name, entityType: auditLog.entityType, entityId: auditLog.entityId, before: auditLog.before, after: auditLog.after })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(where)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(AUDIT_PAGE_SIZE)
      .offset((page - 1) * AUDIT_PAGE_SIZE);
    const actors = await tx.select({ id: users.id, name: users.name }).from(users).orderBy(users.name);
    const entityTypes = (await tx.selectDistinct({ t: auditLog.entityType }).from(auditLog).where(sql`${auditLog.entityType} is not null`)).map((r) => r.t!).sort();
    return { rows, total: Number(n), actors, entityTypes };
  });
}

// ---------------------------------------------------------------------------------------------
// Signal priorities
// ---------------------------------------------------------------------------------------------

export async function getSignalPriorities(workspaceId: string, now = new Date()) {
  return withWorkspace(workspaceId, async (tx) => {
    const [ws] = (await tx.execute<{ settings: unknown }>(sql`select settings from dmi.workspaces where id = ${workspaceId}::uuid`)).rows;
    const overrides = priorityOverrides(ws?.settings);
    const since = new Date(now.getTime() - 90 * 86_400_000);
    const confirmed = await tx.select({ type: signals.type, n: count() }).from(signals).where(and(eq(signals.status, "confirmed"), gte(signals.confirmedAt, since))).groupBy(signals.type);
    const dismissed = await tx
      .select({ type: signals.type, reason: actions.dismissReason, n: count() })
      .from(actions)
      .innerJoin(signals, eq(signals.id, actions.signalId))
      .where(and(eq(actions.status, "dismissed"), gte(actions.updatedAt, since)))
      .groupBy(signals.type, actions.dismissReason);
    const made = await tx.select({ type: signals.type, n: count() }).from(actions).innerJoin(signals, eq(signals.id, actions.signalId)).where(gte(actions.createdAt, since)).groupBy(signals.type);
    return (Object.keys(SIGNAL_RULES) as (keyof typeof SIGNAL_RULES)[]).map((type) => ({
      type,
      defaultPriority: SIGNAL_RULES[type].priority,
      priority: basePriority(type, overrides),
      overridden: overrides[type] !== undefined,
      confirmed: Number(confirmed.find((c) => c.type === type)?.n ?? 0),
      actions: Number(made.find((c) => c.type === type)?.n ?? 0),
      dismissed: dismissed.filter((d) => d.type === type).reduce((sum, d) => sum + Number(d.n), 0),
      dismissedBy: Object.fromEntries(dismissed.filter((d) => d.type === type && d.reason).map((d) => [d.reason!, Number(d.n)])),
    }));
  });
}
