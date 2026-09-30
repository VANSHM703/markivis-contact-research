import type { Metadata } from "next";
import Link from "next/link";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar } from "@/components/ui/FilterBar";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PriorityPill, SIGNAL_TYPE_LABELS, SOURCE_TYPE_LABELS } from "@/components/ui/Priority";
import { SIGNAL_TYPES } from "@/ai/contracts";
import { formatDate, pageParam } from "@/lib/format/labels";
import { can } from "@/lib/permissions";
import { createActionFromSignalAction } from "@/server/signal-actions";
import { listConfirmedSignals, parseSignalFilters } from "@/server/signals";
import { pageContext } from "@/server/guards";
import styles from "@/components/queue/Signals.module.css";

export const metadata: Metadata = { title: "Signals" };

const typeLabel = (t: string) => SIGNAL_TYPE_LABELS[t] ?? t;

export default async function SignalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageContext();
  const params = await searchParams;
  const filters = parseSignalFilters(params);
  const page = pageParam(params.page);
  const { rows, total } = await listConfirmedSignals(ctx.workspace.id, filters, page);
  const canAct = can(ctx.role, "records.edit");

  return (
    <>
      <Notice notice={params.notice} />
      <PageHeader title="Signals" lede={`${total} confirmed changes in the last ${filters.days} days, newest first.`} />
      <FilterBar
        path="/signals"
        searchLabel={null}
        values={{ type: filters.type, priority: filters.priority ? String(filters.priority) : undefined, source: filters.source, days: String(filters.days) }}
        selects={[
          { name: "type", label: "Type", options: SIGNAL_TYPES.map((t) => ({ value: t, label: typeLabel(t) })) },
          { name: "priority", label: "Priority", options: [1, 2, 3].map((p) => ({ value: String(p), label: `P${p}` })) },
          { name: "source", label: "Source", options: Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => ({ value, label })) },
          { name: "days", label: "Period", options: [{ value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }] },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState message="No confirmed signals in this period." />
      ) : (
        <ul className={styles.feed}>
          {rows.map(({ signal, personName, companyName, hasAction, sources }) => (
            <li key={signal.id} className="card">
              <div className={styles.head}>
                <PriorityPill priority={signal.priority} />
                <span className="t-meta t-muted">{typeLabel(signal.type)} · confirmed {formatDate(signal.confirmedAt)}{signal.validatedBy ? "" : " · AUTO"}</span>
              </div>
              <p className={styles.headline}>{signal.headline}</p>
              <p className="t-caption">
                {signal.personId ? <Link href={`/people/${signal.personId}`}>{personName}</Link> : null}
                {signal.personId && signal.companyId ? ", " : null}
                {signal.companyId ? <Link href={`/companies/${signal.companyId}`}>{companyName}</Link> : null}
              </p>
              {sources.length ? (
                <ul className={styles.sources}>
                  {sources.map((s, i) => (
                    <li key={i} className="t-caption">
                      {s.url ? <a href={s.url} rel="noreferrer" target="_blank">{s.title ?? s.url}</a> : (s.title ?? "Untitled")}
                      <span className="t-meta t-muted"> · {SOURCE_TYPE_LABELS[s.type] ?? s.type}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {signal.priority === 3 && !hasAction && canAct ? (
                <form action={createActionFromSignalAction.bind(null, signal.id)}>
                  <SubmitButton variant="ghost">Create action</SubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
