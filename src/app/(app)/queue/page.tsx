import type { Metadata } from "next";
import Link from "next/link";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { ConflictsLane } from "@/components/queue/ConflictsLane";
import { QueueKeyboard } from "@/components/queue/QueueKeyboard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { ConfidenceText, PriorityPill, SIGNAL_TYPE_LABELS, SOURCE_TYPE_LABELS } from "@/components/ui/Priority";
import { Tabs } from "@/components/ui/Tabs";
import { SIGNAL_TYPES } from "@/ai/contracts";
import { formatDate } from "@/lib/format/labels";
import { can } from "@/lib/permissions";
import { REJECT_REASONS } from "@/pipeline/validation";
import { approveBatchAction, confirmSignalAction, parkSignalAction, rejectSignalAction, researchSignalAction, spotCheckAction } from "@/server/queue-actions";
import { getQueueItem, listQueue, queueCounts, type QueueTab } from "@/server/queue";
import { pageContext, UUID_RE } from "@/server/guards";
import { workingDaysBetween } from "@/server/today";
import styles from "@/components/queue/Queue.module.css";

export const metadata: Metadata = { title: "Queue" };

// Lane labels from the design file, section 12, plus the shadow run (BRD 24.1).
const TABS: { key: QueueTab; label: string }[] = [
  { key: "review", label: "Review" },
  { key: "batch", label: "Weekly batch" },
  { key: "research", label: "More research" },
  { key: "parked", label: "Parked" },
  { key: "spot", label: "Spot checks" },
  { key: "conflicts", label: "Conflicts and duplicates" },
  { key: "shadow", label: "Shadow" },
];

const REASON_LABELS: Record<string, string> = { wrong_person: "Wrong person", not_a_change: "Not a change", duplicate: "Duplicate", out_of_date: "Out of date", not_relevant: "Not relevant" };
const LANE_LABELS: Record<string, string> = { auto_confirm: "Auto-confirm", review: "Review", weekly_batch: "Weekly batch", more_research: "More research" };
const typeLabel = (t: string) => SIGNAL_TYPE_LABELS[t] ?? t;

type Search = { tab?: string; item?: string; notice?: string; count?: string };

export default async function QueuePage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await pageContext();
  if (!can(ctx.role, "queue.work")) {
    return (
      <>
        <PageHeader title="Queue" lede="Validate detected changes before they reach the partner." />
        <PermissionDenied who="partners and validators" />
      </>
    );
  }
  const params = await searchParams;
  const tab = (TABS.some((t) => t.key === params.tab) ? params.tab : "review") as QueueTab;
  const counts = await queueCounts(ctx.workspace.id);
  const tabs = TABS.filter((t) => t.key !== "shadow" || counts.shadow > 0 || ctx.workspace.flags["pipeline.shadow"]);
  const now = new Date();

  return (
    <>
      <Notice notice={params.notice} />
      {params.notice === "batch_approved" && params.count ? <p className="visually-hidden" role="status">{params.count} confirmed.</p> : null}
      <PageHeader title="Queue" lede={`${counts.review} to review, ${counts.batch} in the weekly batch. Priority first, then oldest first.`} />
      <Tabs label="Queue lanes" current={tab} tabs={tabs.map((t) => ({ key: t.key, label: counts[t.key] ? `${t.label} (${counts[t.key]})` : t.label, href: `/queue?tab=${t.key}` }))} />
      {tab === "conflicts" ? (
        <ConflictsLane workspaceId={ctx.workspace.id} canMerge={can(ctx.role, "persons.merge")} />
      ) : tab === "batch" && !(params.item && UUID_RE.test(params.item)) ? (
        <BatchLane workspaceId={ctx.workspace.id} now={now} />
      ) : (
        <TwoPane workspaceId={ctx.workspace.id} tab={tab} itemId={params.item && UUID_RE.test(params.item) ? params.item : null} now={now} />
      )}
    </>
  );
}

async function TwoPane({ workspaceId, tab, itemId, now }: { workspaceId: string; tab: QueueTab; itemId: string | null; now: Date }) {
  const rows = await listQueue(workspaceId, tab);
  if (rows.length === 0) return <EmptyState message={tab === "review" ? "The queue is clear." : tab === "spot" ? "No spot checks this week." : tab === "shadow" ? "No shadow signals." : "Nothing here."} />;
  const selectedId = itemId && rows.some((r) => r.id === itemId) ? itemId : null;
  const detail = await getQueueItem(workspaceId, selectedId ?? rows[0]!.id);

  return (
    <div className={selectedId ? `${styles.panes} ${styles.hasItem}` : styles.panes}>
      <nav className={styles.list} aria-label="Items">
        <ul>
          {rows.map((r) => {
            const active = r.id === (selectedId ?? rows[0]!.id);
            const age = workingDaysBetween(r.foundAt, now);
            return (
              <li key={r.id}>
                <Link href={`/queue?tab=${tab}&item=${r.id}`} className={active ? `${styles.row} ${styles.active}` : styles.row} aria-current={active ? "true" : undefined}>
                  <span className={styles.rowTop}>
                    <PriorityPill priority={r.priority} />
                    <span className={styles.headline}>{r.headline}</span>
                  </span>
                  <span className={styles.rowMeta}>
                    <span>{r.subject}</span>
                    <span className="t-meta">
                      {r.sourceTypes.map((t) => SOURCE_TYPE_LABELS[t] ?? t).join(", ") || "Rule"} · <span className={age > 3 ? styles.old : undefined}>{age} {age === 1 ? "working day" : "working days"}</span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {detail ? <Detail detail={detail} tab={tab} /> : null}
    </div>
  );
}

type DetailData = NonNullable<Awaited<ReturnType<typeof getQueueItem>>>;

function Detail({ detail, tab }: { detail: DetailData; tab: QueueTab }) {
  const { signal, person, company, sources, changes } = detail;
  const explanation = signal.explanation as { prefilter?: string; confidence?: string; priority?: string; lane?: string; note?: string; rule?: string };
  const notes = signal.researchNotes as { verdict: string; note: string; at: string }[];
  const decidable = tab !== "spot" && tab !== "shadow";
  const hrefFor = (id: string | null) => (id ? `/queue?tab=${tab}&item=${id}` : null);

  return (
    <article className={styles.detail} aria-labelledby="item-heading">
      <Link href={`/queue?tab=${tab}`} className={styles.back}>
        Back to the list
      </Link>
      <div className={styles.detailBody}>
        <div className={styles.detailHead}>
          <PriorityPill priority={signal.priority} />
          <span className="t-meta t-muted">{typeLabel(signal.type)}</span>
        </div>
        <h2 id="item-heading" className="t-heading-card">{signal.headline}</h2>
        <p>
          {person ? <Link href={`/people/${person.id}`}>{person.fullName}</Link> : null}
          {person && company ? ", " : null}
          {company ? <Link href={`/companies/${company.id}`}>{company.name}</Link> : null}
        </p>
        {explanation.note ? <p className={styles.warn}>{explanation.note}. Read the source and decide.</p> : null}
        {signal.evidence ? <blockquote className={styles.evidence}>{signal.evidence}</blockquote> : null}

        <section aria-labelledby="sources-heading">
          <h3 id="sources-heading" className={styles.subhead}>Sources ({sources.length})</h3>
          <ul className={styles.sources}>
            {sources.map((s) => (
              <li key={s.id}>
                {s.url ? (
                  <a href={s.url} rel="noreferrer" target="_blank">
                    {s.title ?? s.url}
                  </a>
                ) : (
                  <span>{s.title ?? "Untitled"}</span>
                )}
                <span className="t-meta t-muted">
                  {SOURCE_TYPE_LABELS[s.sourceType] ?? s.sourceType}
                  {s.publishedAt ? ` · ${formatDate(s.publishedAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <dl className={styles.facts}>
          <div><dt>Confidence</dt><dd><ConfidenceText confidence={signal.confidence} /> <span className="t-caption t-muted">{explanation.confidence}</span></dd></div>
          <div><dt>Lane</dt><dd>{LANE_LABELS[signal.lane] ?? signal.lane} <span className="t-caption t-muted">{explanation.lane ?? explanation.rule}</span></dd></div>
          <div><dt>Match</dt><dd className="t-meta">{signal.matchScore ?? "n/a"}</dd></div>
          {signal.eventOn ? <div><dt>Event</dt><dd className="t-meta">{formatDate(signal.eventOn)}</dd></div> : null}
          {signal.effectiveOn ? <div><dt>Effective</dt><dd className="t-meta">{formatDate(signal.effectiveOn)}</dd></div> : null}
          <div><dt>Research</dt><dd className="t-meta">{signal.researchCycles} of 2 cycles</dd></div>
        </dl>

        {changes.length ? (
          <section aria-labelledby="changes-heading">
            <h3 id="changes-heading" className={styles.subhead}>Record changes on confirmation</h3>
            <div className={styles.tableWrap}>
              <table className={styles.changes}>
                <thead>
                  <tr><th scope="col">Record</th><th scope="col">Before</th><th scope="col">After</th></tr>
                </thead>
                <tbody>
                  {changes.map((c, i) => (
                    <tr key={i}><th scope="row">{c.record}</th><td>{c.before}</td><td>{c.after}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {notes.length ? (
          <section aria-labelledby="notes-heading">
            <h3 id="notes-heading" className={styles.subhead}>Research</h3>
            <ul className={styles.sources}>
              {notes.map((n, i) => (
                <li key={i}>
                  <span>{n.note}</span>
                  <span className="t-meta t-muted">{n.verdict.toUpperCase()} · {formatDate(n.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {decidable ? (
          <details id="edit-panel" className={styles.edit}>
            <summary>Edit before confirming <kbd className={styles.key}>E</kbd></summary>
            <div className={styles.editGrid}>
              <label>
                <span className={styles.label}>Headline</span>
                <input form="confirm-form" name="headline" defaultValue={signal.headline} maxLength={140} className={styles.input} />
              </label>
              <label>
                <span className={styles.label}>Type</span>
                <select form="confirm-form" name="type" defaultValue={signal.type} className={styles.input}>
                  {SIGNAL_TYPES.map((t) => (
                    <option key={t} value={t}>{typeLabel(t)}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className={styles.label}>Priority</span>
                <select form="confirm-form" name="priority" defaultValue={String(signal.priority)} className={styles.input}>
                  {[1, 2, 3].map((p) => <option key={p} value={p}>P{p}</option>)}
                </select>
              </label>
              <label>
                <span className={styles.label}>Confidence</span>
                <select form="confirm-form" name="confidence" defaultValue={signal.confidence} className={styles.input}>
                  {["high", "medium", "low"].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>
                <span className={styles.label}>Event date</span>
                <input form="confirm-form" type="date" name="event_on" defaultValue={signal.eventOn ?? ""} className={styles.input} />
              </label>
              <label>
                <span className={styles.label}>Effective date</span>
                <input form="confirm-form" type="date" name="effective_on" defaultValue={signal.effectiveOn ?? ""} className={styles.input} />
              </label>
            </div>
          </details>
        ) : null}
      </div>

      <div className={styles.decisionBar}>
        {tab === "spot" ? (
          <>
            <form action={spotCheckAction.bind(null, signal.id)}>
              <input type="hidden" name="result" value="correct" />
              <SubmitButton>Correct</SubmitButton>
            </form>
            <form action={spotCheckAction.bind(null, signal.id)}>
              <input type="hidden" name="result" value="incorrect" />
              <SubmitButton variant="ghost">Incorrect</SubmitButton>
            </form>
          </>
        ) : decidable ? (
          <>
            <form id="confirm-form" action={confirmSignalAction.bind(null, signal.id, tab as "review")}>
              <SubmitButton>Confirm change</SubmitButton>
            </form>
            <kbd className={styles.key} aria-hidden="true">C</kbd>
            <details id="reject-menu" className={styles.reject}>
              <summary className="btn btn--ghost">Reject</summary>
              <form action={rejectSignalAction.bind(null, signal.id, tab as "review")} className={styles.reasons}>
                <p className={styles.label}>Why?</p>
                {REJECT_REASONS.map((r, i) => (
                  <button key={r} type="submit" name="reason" value={r} className={styles.reason}>
                    <kbd className={styles.key}>{i + 1}</kbd> {REASON_LABELS[r]}
                  </button>
                ))}
              </form>
            </details>
            <kbd className={styles.key} aria-hidden="true">R</kbd>
            <form id="research-form" action={researchSignalAction.bind(null, signal.id, tab as "review")}>
              <button type="submit" className="btn btn--ghost" disabled={!detail.canResearch} aria-describedby={detail.canResearch ? undefined : "research-limit"}>
                More research
              </button>
            </form>
            <kbd className={styles.key} aria-hidden="true">M</kbd>
            <form id="park-form" action={parkSignalAction.bind(null, signal.id, tab as "review")}>
              <button type="submit" className={styles.textLink}>Park</button>
            </form>
            <kbd className={styles.key} aria-hidden="true">P</kbd>
            {!detail.canResearch ? <p id="research-limit" className="t-caption t-muted">Research used: confirm, reject or park.</p> : null}
          </>
        ) : null}
        <QueueKeyboard prevHref={hrefFor(detail.prevId)} nextHref={hrefFor(detail.nextId)} canResearch={detail.canResearch && decidable} />
      </div>
    </article>
  );
}

async function BatchLane({ workspaceId, now }: { workspaceId: string; now: Date }) {
  const rows = await listQueue(workspaceId, "batch");
  if (rows.length === 0) return <EmptyState message="Nothing in this week's batch." />;
  return (
    <form action={approveBatchAction} className={styles.batch}>
      <p className="t-caption t-muted">Everything is ticked. Untick anything you want to open on its own; it stays in the batch.</p>
      <ul className={styles.batchList}>
        {rows.map((r) => (
          <li key={r.id}>
            <label className={styles.batchRow}>
              <input type="checkbox" name="signal_id" value={r.id} defaultChecked />
              <span className={styles.batchText}>
                <span className={styles.headline}>{r.headline}</span>
                <span className="t-meta t-muted">
                  {r.subject} · {r.sourceTypes.map((t) => SOURCE_TYPE_LABELS[t] ?? t).join(", ") || "Rule"} · {workingDaysBetween(r.foundAt, now)} working days
                </span>
              </span>
            </label>
            <Link href={`/queue?tab=batch&item=${r.id}`} className={styles.open}>
              Open
            </Link>
          </li>
        ))}
      </ul>
      <div className={styles.batchBar}>
        <SubmitButton>{`Approve ticked items`}</SubmitButton>
      </div>
    </form>
  );
}
