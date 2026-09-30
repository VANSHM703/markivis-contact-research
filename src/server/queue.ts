/** Read queries for the validation queue (BRD 10, design file 9.5). */
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { companies, persons, queueItems, roles, signals, signalSources } from "@/db/schema";
import type { ProposedChange } from "@/pipeline/process";
import { canResearch } from "@/pipeline/validation";

export type QueueTab = "review" | "batch" | "research" | "parked" | "spot" | "shadow" | "conflicts";

function tabWhere(tab: QueueTab): SQL | undefined {
  switch (tab) {
    case "review":
      return and(eq(signals.lane, "review"), eq(signals.status, "pending"));
    case "batch":
      return and(eq(signals.lane, "weekly_batch"), eq(signals.status, "pending"));
    case "research":
      return eq(signals.status, "needs_info");
    case "parked":
      return eq(signals.status, "parked");
    case "spot":
      return and(eq(signals.isSpotCheck, true), isNull(signals.spotCheckResult));
    case "shadow":
      return eq(signals.status, "shadow");
    default:
      return undefined;
  }
}

export interface QueueRow {
  id: string;
  priority: number;
  headline: string;
  subject: string;
  foundAt: Date;
  confidence: string;
  sourceTypes: string[];
}

/** Priority ascending, then oldest first (BRD 10.3). */
export async function listQueue(workspaceId: string, tab: QueueTab, limit = 200): Promise<QueueRow[]> {
  const where = tabWhere(tab);
  if (!where) return [];
  return withWorkspace(workspaceId, async (tx) => {
    const rows = await tx
      .select({
        id: signals.id,
        priority: signals.priority,
        headline: signals.headline,
        foundAt: signals.foundAt,
        confidence: signals.confidence,
        personName: persons.fullName,
        companyName: companies.name,
        sourceTypes: sql<string[]>`coalesce((select array_agg(distinct ss.source_type::text) from ${signalSources} ss where ss.signal_id = ${signals}.id), '{}')`,
      })
      .from(signals)
      .leftJoin(persons, eq(persons.id, signals.personId))
      .leftJoin(companies, eq(companies.id, signals.companyId))
      .where(and(where, isNull(signals.mergedIntoId)))
      .orderBy(asc(signals.priority), asc(signals.foundAt))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, priority: r.priority, headline: r.headline, subject: r.personName ?? r.companyName ?? "Unknown", foundAt: r.foundAt, confidence: r.confidence, sourceTypes: r.sourceTypes }));
  });
}

export async function queueCounts(workspaceId: string): Promise<Record<QueueTab, number>> {
  return withWorkspace(workspaceId, async (tx) => {
    const out = {} as Record<QueueTab, number>;
    for (const tab of ["review", "batch", "research", "parked", "spot", "shadow"] as const) {
      const [row] = await tx.select({ n: count() }).from(signals).where(and(tabWhere(tab), isNull(signals.mergedIntoId)));
      out[tab] = row?.n ?? 0;
    }
    const [conflicts] = await tx.select({ n: count() }).from(queueItems).where(eq(queueItems.status, "pending"));
    out.conflicts = conflicts?.n ?? 0;
    return out;
  });
}

export interface ChangeRow {
  record: string;
  before: string;
  after: string;
}

export async function getQueueItem(workspaceId: string, signalId: string) {
  return withWorkspace(workspaceId, async (tx) => {
    const [signal] = await tx.select().from(signals).where(eq(signals.id, signalId)).limit(1);
    if (!signal) return null;
    const [person] = signal.personId ? await tx.select({ id: persons.id, fullName: persons.fullName }).from(persons).where(eq(persons.id, signal.personId)).limit(1) : [];
    const [company] = signal.companyId ? await tx.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, signal.companyId)).limit(1) : [];
    const sources = await tx.select().from(signalSources).where(eq(signalSources.signalId, signalId)).orderBy(desc(signalSources.publishedAt));

    // Proposed record changes as before and after (design file 9.5).
    const proposed = signal.proposedChanges as ProposedChange[];
    const companyIds = proposed.flatMap((c) => ("company_id" in c ? [c.company_id] : []));
    const names = new Map((companyIds.length ? await tx.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, companyIds)) : []).map((c) => [c.id, c.name]));
    const roleIds = proposed.flatMap((c) => (c.kind === "end_role" ? [c.role_id] : []));
    const roleRows = new Map((roleIds.length ? await tx.select().from(roles).where(inArray(roles.id, roleIds)) : []).map((r) => [r.id, r]));
    const changes: ChangeRow[] = proposed.map((c) => {
      if (c.kind === "end_role") {
        const r = roleRows.get(c.role_id);
        return { record: `${c.title}, ${names.get(c.company_id) ?? "company"}`, before: r ? (r.status === "ended" ? `Ended ${r.endedOn ?? ""}` : "Current") : "Current", after: `Ended ${c.ended_on}` };
      }
      if (c.kind === "add_role") return { record: `${c.title}, ${names.get(c.company_id) ?? "company"}`, before: "No such role", after: `${c.status === "announced" ? "Announced" : "Current"}, from ${c.effective_on ?? "today"}` };
      return { record: "Target list", before: "On the list", after: "Off the list: employer not tracked" };
    });

    const siblings = await listQueue(workspaceId, signal.isSpotCheck && !signal.spotCheckResult ? "spot" : signal.status === "parked" ? "parked" : signal.status === "needs_info" ? "research" : signal.lane === "weekly_batch" ? "batch" : "review");
    const index = siblings.findIndex((s) => s.id === signalId);
    return {
      signal,
      person: person ?? null,
      company: company ?? null,
      sources,
      changes,
      canResearch: canResearch(signal),
      prevId: index > 0 ? siblings[index - 1]!.id : null,
      nextId: index >= 0 && index < siblings.length - 1 ? siblings[index + 1]!.id : null,
    };
  });
}

/** The next item in a tab after a decision, so the validator keeps moving (design file 9.11 live region). */
export async function nextInTab(workspaceId: string, tab: QueueTab, afterId?: string): Promise<string | null> {
  const rows = await listQueue(workspaceId, tab);
  return rows.find((r) => r.id !== afterId)?.id ?? null;
}
