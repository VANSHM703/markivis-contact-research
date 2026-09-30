/**
 * Connections between people (BRD 11.6). Derived nightly from roles, and added by hand on a
 * person page. A pair is stored once, with the lower id first (the table's check constraint).
 *
 *   shared_board        both on the same board, overlapping 6 months or more        0.80
 *   shared_board        one C-suite and one on the board, overlapping 12 months     0.75
 *   overlapping_tenure  both executives, 12 months, one C-suite, company < 2,000    0.60
 *   overlapping_tenure  as above, in the same function                             0.70
 */
import { and, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { withWorkspace, type Tx } from "@/db/client";
import { companies, connections, persons, roles, workspaces } from "@/db/schema";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";
import type { WorkspaceRole } from "@/config/navigation";

const DAY = 86_400_000;
export const MANUAL_WEIGHTS = { reported_to: 0.9, introduced_by: 0.7, deal_counterpart: 0.6, manual_other: 0.5 } as const;
export type ManualType = keyof typeof MANUAL_WEIGHTS;
export const CONNECTION_LABELS: Record<string, string> = {
  shared_board: "Shared board",
  overlapping_tenure: "Worked together",
  reported_to: "Reporting line",
  introduced_by: "Introduced by",
  deal_counterpart: "Deal counterpart",
  manual_other: "Knows",
};

export interface RoleSpan {
  personId: string;
  companyId: string;
  seatType: string;
  seniority: string;
  function: string | null;
  start: string | null;
  end: string | null;
  status: string;
  employeeCount: number | null;
}

export interface DerivedConnection {
  a: string;
  b: string;
  type: "shared_board" | "overlapping_tenure";
  companyId: string;
  weight: number;
  periodStart: string;
  periodEnd: string;
}

export interface ConnectionSettings {
  max_company_size: number;
  board_overlap_months: number;
  exec_overlap_months: number;
}

const days = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY;
const months = (m: number) => m * 30.44;

/** Pure: the connections a set of roles implies. */
export function deriveFromRoles(spans: RoleSpan[], today: string, s: ConnectionSettings): DerivedConnection[] {
  const byCompany = new Map<string, RoleSpan[]>();
  for (const r of spans) {
    if (r.status === "announced" || !r.start) continue;
    if (r.status === "ended" && !r.end) continue;
    byCompany.set(r.companyId, [...(byCompany.get(r.companyId) ?? []), r]);
  }
  const best = new Map<string, DerivedConnection>();
  const keep = (c: DerivedConnection) => {
    const key = `${c.a}|${c.b}|${c.type}|${c.companyId}`;
    const prev = best.get(key);
    if (!prev || c.weight > prev.weight || (c.weight === prev.weight && days(c.periodStart, c.periodEnd) > days(prev.periodStart, prev.periodEnd))) best.set(key, c);
  };
  for (const [companyId, list] of byCompany) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i]!;
        const y = list[j]!;
        if (x.personId === y.personId) continue;
        const start = x.start! > y.start! ? x.start! : y.start!;
        const endX = x.end ?? today;
        const endY = y.end ?? today;
        const end = endX < endY ? endX : endY;
        const overlap = days(start, end);
        if (overlap <= 0) continue;
        const [a, b] = x.personId < y.personId ? [x.personId, y.personId] : [y.personId, x.personId];
        const base = { a, b, companyId, periodStart: start, periodEnd: end };
        const board = (r: RoleSpan) => r.seatType === "board";
        const exec = (r: RoleSpan) => r.seatType === "executive";
        const csuite = (r: RoleSpan) => exec(r) && r.seniority === "c_suite";
        if (board(x) && board(y) && overlap >= months(s.board_overlap_months)) keep({ ...base, type: "shared_board", weight: 0.8 });
        if (((csuite(x) && board(y)) || (csuite(y) && board(x))) && overlap >= months(12)) keep({ ...base, type: "shared_board", weight: 0.75 });
        const small = x.employeeCount === null || x.employeeCount < s.max_company_size;
        if (exec(x) && exec(y) && small && (csuite(x) || csuite(y)) && overlap >= months(s.exec_overlap_months)) {
          const sameFunction = !!x.function && !!y.function && x.function.toLowerCase() === y.function.toLowerCase();
          keep({ ...base, type: "overlapping_tenure", weight: sameFunction ? 0.7 : 0.6 });
        }
      }
    }
  }
  return Array.from(best.values());
}

export async function deriveConnections(workspaceId: string, today = new Date().toISOString().slice(0, 10)): Promise<{ derived: number; removed: number }> {
  return withWorkspace(workspaceId, async (tx) => {
    const [ws] = await tx.select({ settings: workspaces.settings, flags: workspaces.flags }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if ((ws!.flags as Record<string, boolean>)["rel.connections"] === false) return { derived: 0, removed: 0 };
    const c = ((ws!.settings as Record<string, unknown>).connections ?? {}) as Partial<ConnectionSettings>;
    const settings: ConnectionSettings = { max_company_size: c.max_company_size ?? 2000, board_overlap_months: c.board_overlap_months ?? 6, exec_overlap_months: c.exec_overlap_months ?? 12 };
    const spans = await tx
      .select({ personId: roles.personId, companyId: roles.companyId, seatType: roles.seatType, seniority: roles.seniority, function: roles.function, start: roles.effectiveOn, end: roles.endedOn, status: roles.status, employeeCount: companies.employeeCount })
      .from(roles)
      .innerJoin(companies, eq(companies.id, roles.companyId))
      .innerJoin(persons, eq(persons.id, roles.personId))
      .where(sql`${persons.mergedIntoId} is null`);
    const derived = deriveFromRoles(spans, today, settings);
    const kept: string[] = [];
    for (const d of derived) {
      const [row] = await tx
        .insert(connections)
        .values({ workspaceId, personAId: d.a, personBId: d.b, type: d.type, companyId: d.companyId, periodStart: d.periodStart, periodEnd: d.periodEnd, weight: d.weight.toFixed(2), derived: true })
        .onConflictDoUpdate({ target: [connections.personAId, connections.personBId, connections.type, connections.companyId], set: { periodStart: d.periodStart, periodEnd: d.periodEnd, weight: d.weight.toFixed(2), derived: true } })
        .returning({ id: connections.id });
      kept.push(row!.id);
    }
    const removed = await tx
      .delete(connections)
      .where(and(eq(connections.derived, true), kept.length ? notInArray(connections.id, kept) : undefined))
      .returning({ id: connections.id });
    return { derived: derived.length, removed: removed.length };
  });
}

export async function addManualConnection(tx: Tx, actor: { workspaceId: string; userId: string; role: WorkspaceRole }, input: { personId: string; otherId: string; type: ManualType; companyId?: string | null; note?: string | null }): Promise<string> {
  assertCan(actor.role, "records.edit");
  if (input.personId === input.otherId) throw new Error("Choose a different person.");
  const found = await tx.select({ id: persons.id }).from(persons).where(inArray(persons.id, [input.personId, input.otherId]));
  if (found.length !== 2) throw new Error("Both people must be in this workspace.");
  const [a, b] = input.personId < input.otherId ? [input.personId, input.otherId] : [input.otherId, input.personId];
  const [row] = await tx
    .insert(connections)
    .values({ workspaceId: actor.workspaceId, personAId: a, personBId: b, type: input.type, companyId: input.companyId ?? null, weight: MANUAL_WEIGHTS[input.type].toFixed(2), derived: false, note: input.note?.trim().slice(0, 300) || null })
    .onConflictDoUpdate({ target: [connections.personAId, connections.personBId, connections.type, connections.companyId], set: { note: input.note?.trim().slice(0, 300) || null, derived: false, weight: MANUAL_WEIGHTS[input.type].toFixed(2) } })
    .returning({ id: connections.id });
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "connection.added", entityType: "person", entityId: input.personId, after: { other_id: input.otherId, type: input.type } });
  return row!.id;
}

export async function removeManualConnection(tx: Tx, actor: { workspaceId: string; userId: string; role: WorkspaceRole }, connectionId: string): Promise<void> {
  assertCan(actor.role, "records.edit");
  await tx.delete(connections).where(and(eq(connections.id, connectionId), eq(connections.derived, false)));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "connection.removed", entityType: "connection", entityId: connectionId });
}

/** Every connection of a person, with the other person and the company. */
export async function connectionsOf(tx: Tx, personId: string) {
  const rows = await tx
    .select({ c: connections, companyName: companies.name })
    .from(connections)
    .leftJoin(companies, eq(companies.id, connections.companyId))
    .where(or(eq(connections.personAId, personId), eq(connections.personBId, personId)));
  const others = rows.map((r) => (r.c.personAId === personId ? r.c.personBId : r.c.personAId));
  const names = others.length ? await tx.select({ id: persons.id, name: persons.fullName, status: persons.status, mergedIntoId: persons.mergedIntoId }).from(persons).where(inArray(persons.id, others)) : [];
  return rows.map((r) => {
    const otherId = r.c.personAId === personId ? r.c.personBId : r.c.personAId;
    const other = names.find((n) => n.id === otherId);
    return { id: r.c.id, otherId, otherName: other?.name ?? "Unknown", otherStatus: other?.status ?? "active", otherMerged: !!other?.mergedIntoId, type: r.c.type, weight: Number(r.c.weight), companyId: r.c.companyId, companyName: r.companyName, periodStart: r.c.periodStart, periodEnd: r.c.periodEnd, derived: r.c.derived, note: r.c.note };
  });
}
