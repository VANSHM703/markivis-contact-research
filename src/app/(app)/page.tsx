import Link from "next/link";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Notice } from "@/components/ui/Notice";
import { Panel, PanelEmpty } from "@/components/ui/Panel";
import { PriorityPill, SOURCE_TYPE_LABELS, StatePill } from "@/components/ui/Priority";
import { formatDateIn, formatTimeIn } from "@/lib/format/labels";
import { can } from "@/lib/permissions";
import { suspendedSourceTypes } from "@/pipeline/validation";
import { reenableAutoConfirmAction } from "@/server/queue-actions";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReadoutBand } from "@/components/ui/ReadoutBand";
import { getRequestContext } from "@/lib/context";
import { getTodayFigures, getTodayPanels, workingDaysBetween, type OutcomeCounts, type TodayAction } from "@/server/today";
import styles from "./page.module.css";

function ActionLine({ a, tz }: { a: TodayAction; tz: string }) {
  return (
    <li className={styles.item}>
      <Link href={`/actions?owner=all&id=${a.id}`} className={styles.itemLink}>
        {a.priority ? <PriorityPill priority={a.priority} /> : <span aria-hidden="true" />}
        <span className={styles.itemText}>
          <span className={styles.itemWho}>{a.personName ?? "No contact yet"}</span>
          <span className="t-caption t-muted">{a.headline}</span>
        </span>
        <span className={styles.itemSide}>
          {a.escalated ? <StatePill tone="warn">Escalated</StatePill> : null}
          <span className={`t-meta ${a.overdue ? styles.overdue : "t-muted"}`}>{a.overdue ? "Overdue " : "Due "}{formatDateIn(a.dueAt, tz)}</span>
        </span>
      </Link>
    </li>
  );
}

function Outcomes({ now, last }: { now: OutcomeCounts; last: OutcomeCounts }) {
  const rows: [string, keyof OutcomeCounts][] = [["Messages sent", "sent"], ["Replied", "replied"], ["Meetings", "meeting"], ["Mandates", "mandate"]];
  return (
    <>
      {rows.map(([label, key]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>{now[key]} <span className="t-muted">(last month {last[key]})</span></dd>
        </div>
      ))}
    </>
  );
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  const now = new Date();
  const tz = ctx.workspace.timezone;
  const [f, p] = await Promise.all([getTodayFigures(ctx.workspace.id, ctx.user.id, now, tz), getTodayPanels(ctx, now)]);
  const oldestAge = f.oldestQueueItemAt ? workingDaysBetween(f.oldestQueueItemAt, now) : 0;
  const { notice } = await searchParams;
  const suspended = suspendedSourceTypes(ctx.workspace.settings);
  const canReenable = can(ctx.role, "settings.change");
  const queueTotal = p.queue ? p.queue.review + p.queue.batch + p.queue.research + p.queue.conflicts : 0;
  const nothingToDo = p.myActions.length + p.awaitingApproval.length + p.p1Changes.length + p.meetings.length + p.goingQuiet.length + queueTotal === 0;

  return (
    <>
      <Notice notice={notice} />
      <PageHeader title="Today" lede={`What needs you today in ${ctx.workspace.name}, in order.`} />
      <div className={styles.stack}>
        <ReadoutBand
          label="Today at a glance"
          figures={[
            { label: "Actions due today", value: String(f.actionsDueToday + f.actionsOverdue), overTarget: f.actionsOverdue > 0 },
            { label: "Drafts awaiting approval", value: String(f.draftsAwaitingApproval) },
            { label: "Items in the queue", value: String(f.queueItems) },
            { label: "Oldest item, working days", value: String(oldestAge), overTarget: oldestAge > 3 },
          ]}
        />
        {suspended.map((sus) => (
          <section key={sus.sourceType} className={`card ${styles.alert}`} aria-label="Auto-confirm suspended">
            <p className="t-eyebrow">Auto-confirm suspended</p>
            <p>
              {SOURCE_TYPE_LABELS[sus.sourceType] ?? sus.sourceType}: auto-confirm has been off since {formatDateIn(new Date(sus.since), tz)}, because spot checks found errors above the limit. New items from this source wait for review.
            </p>
            <div className="btn-row">
              <Link href="/queue?tab=spot" className="btn btn--ghost">Open spot checks</Link>
              {canReenable ? (
                <form action={reenableAutoConfirmAction.bind(null, sus.sourceType)}>
                  <SubmitButton variant="ghost">Re-enable auto-confirm</SubmitButton>
                </form>
              ) : null}
            </div>
          </section>
        ))}
        {nothingToDo ? <EmptyState message="Nothing needs you today. New changes appear here as they are confirmed." /> : null}

        <div className={styles.panels}>
          <Panel title="My actions" count={p.myActions.length + p.awaitingApproval.length} viewAll={{ href: "/actions" }}>
            {p.myActions.length ? (
              <ul className={styles.items} aria-label="Due today and overdue">{p.myActions.slice(0, 6).map((a) => <ActionLine key={a.id} a={a} tz={tz} />)}</ul>
            ) : (
              <PanelEmpty>No actions due today.</PanelEmpty>
            )}
            {p.awaitingApproval.length ? (
              <>
                <h3 className={styles.subhead}>Drafts awaiting approval</h3>
                <ul className={styles.items} aria-label="Drafts awaiting approval">{p.awaitingApproval.map((a) => <ActionLine key={a.id} a={a} tz={tz} />)}</ul>
              </>
            ) : null}
          </Panel>

          <Panel title="Priority 1 changes on my relationships" count={p.p1Changes.length} viewAll={{ href: "/signals?priority=1&days=7" }}>
            {p.p1Changes.length ? (
              <ul className={styles.items}>
                {p.p1Changes.map((s) => (
                  <li key={s.id} className={styles.item}>
                    <Link href={`/people/${s.personId}`} className={styles.itemLink}>
                      <PriorityPill priority={1} />
                      <span className={styles.itemText}>
                        <span className={styles.itemWho}>{s.personName}</span>
                        <span className="t-caption t-muted">{s.headline}</span>
                      </span>
                      <span className={styles.itemSide}><span className="t-meta t-muted">{s.confirmedAt ? `Confirmed ${formatDateIn(s.confirmedAt, tz)}` : ""}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmpty>No priority 1 changes on your relationships in the last 7 days.</PanelEmpty>
            )}
          </Panel>

          <Panel title="Meetings in the next 24 hours" count={p.meetings.length}>
            {p.meetings.length ? (
              <ul className={styles.items}>
                {p.meetings.map((m) => (
                  <li key={m.id} className={styles.item}>
                    <Link href={m.personId ? `/people/${m.personId}` : "/"} className={styles.itemLink}>
                      <span className="t-meta">{formatTimeIn(m.startsAt, tz)}</span>
                      <span className={styles.itemText}>
                        <span className={styles.itemWho}>{m.title ?? "Meeting"}</span>
                        <span className="t-caption t-muted">{m.briefId ? "Brief ready" : "Brief not ready yet"}{m.personName ? `. With ${m.personName}` : ""}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmpty>No meetings with tracked people in the next 24 hours.</PanelEmpty>
            )}
          </Panel>

          <Panel title="Going quiet" count={p.goingQuiet.length}>
            {p.goingQuiet.length ? (
              <ul className={styles.items}>
                {p.goingQuiet.map((q) => (
                  <li key={q.id} className={styles.item}>
                    <Link href={q.personId ? `/people/${q.personId}` : "/signals"} className={styles.itemLink}>
                      <span className={styles.itemText}><span className="t-caption">{q.headline}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmpty>No relationships going quiet.</PanelEmpty>
            )}
          </Panel>

          {p.queue ? (
            <Panel title="Validation queue" count={queueTotal} viewAll={{ href: "/queue", label: "Open the queue" }}>
              <dl className={styles.rows}>
                <div><dt>Review</dt><dd>{p.queue.review}</dd></div>
                <div><dt>Weekly batch</dt><dd>{p.queue.batch}</dd></div>
                <div><dt>More research</dt><dd>{p.queue.research}</dd></div>
                <div><dt>Conflicts and duplicates</dt><dd>{p.queue.conflicts}</dd></div>
                <div><dt>Oldest item</dt><dd className={oldestAge > 3 ? styles.overdue : undefined}>{oldestAge} working {oldestAge === 1 ? "day" : "days"}{oldestAge > 3 ? ", over target" : ""}</dd></div>
              </dl>
            </Panel>
          ) : null}

          <Panel title="Outcomes this month versus last">
            <dl className={styles.rows}>
              <Outcomes now={p.outcomes.thisMonth} last={p.outcomes.lastMonth} />
            </dl>
          </Panel>

          {p.health ? (
            <Panel title="Data health" viewAll={{ href: "/settings/sources", label: "Sources" }}>
              <dl className={styles.rows}>
                <div>
                  <dt>Sources failing</dt>
                  <dd className={p.health.failingFeeds.length ? styles.overdue : undefined}>{p.health.failingFeeds.length ? p.health.failingFeeds.map((x) => `${x.name} (${x.failures} in a row)`).join("; ") : "None"}</dd>
                </div>
                <div>
                  <dt>AI spend this month</dt>
                  <dd className={p.health.aiSpentUsd >= p.health.aiBudgetUsd * 0.8 ? styles.overdue : undefined}>${p.health.aiSpentUsd.toFixed(2)} of ${p.health.aiBudgetUsd.toFixed(0)}</dd>
                </div>
                <div>
                  <dt>Emails that failed to send</dt>
                  <dd className={p.health.failedEmails ? styles.overdue : undefined}>{p.health.failedEmails}</dd>
                </div>
              </dl>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
