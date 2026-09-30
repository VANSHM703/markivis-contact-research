/** Confirmed signals for the Signals screen (BRD 16.2), with filters in the URL (BRD 16.3). */
import { and, count, desc, eq, gte, isNull, sql, type SQL } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { actions, companies, persons, signals, signalSources } from "@/db/schema";

export interface SignalFilters {
  type?: string;
  priority?: 1 | 2 | 3;
  source?: string;
  days?: 7 | 30 | 90;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export function parseSignalFilters(params: Params): SignalFilters {
  const priority = Number(one(params.priority));
  const days = Number(one(params.days));
  return {
    type: one(params.type)?.replace(/[^a-z_]/g, "") || undefined,
    priority: [1, 2, 3].includes(priority) ? (priority as 1 | 2 | 3) : undefined,
    source: one(params.source)?.replace(/[^a-z0-9_]/g, "") || undefined,
    days: [7, 30, 90].includes(days) ? (days as 7 | 30 | 90) : 30,
  };
}

export async function listConfirmedSignals(workspaceId: string, f: SignalFilters, page = 1, pageSize = 50) {
  const clauses: (SQL | undefined)[] = [eq(signals.status, "confirmed"), isNull(signals.mergedIntoId)];
  if (f.type) clauses.push(sql`${signals.type} = ${f.type}`);
  if (f.priority) clauses.push(eq(signals.priority, f.priority));
  if (f.source) clauses.push(sql`exists (select 1 from ${signalSources} ss where ss.signal_id = ${signals}.id and ss.source_type::text = ${f.source})`);
  if (f.days) clauses.push(gte(signals.confirmedAt, new Date(Date.now() - f.days * 86_400_000)));
  const where = and(...clauses);
  return withWorkspace(workspaceId, async (tx) => {
    const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(signals).where(where);
    const rows = await tx
      .select({
        signal: signals,
        personName: persons.fullName,
        companyName: companies.name,
        hasAction: sql<boolean>`exists (select 1 from ${actions} a where a.signal_id = ${signals}.id)`,
        sources: sql<{ url: string | null; title: string | null; type: string }[]>`coalesce((select json_agg(json_build_object('url', ss.url, 'title', ss.title, 'type', ss.source_type)) from ${signalSources} ss where ss.signal_id = ${signals}.id), '[]')`,
      })
      .from(signals)
      .leftJoin(persons, eq(persons.id, signals.personId))
      .leftJoin(companies, eq(companies.id, signals.companyId))
      .where(where)
      .orderBy(desc(signals.confirmedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { rows, total };
  });
}
