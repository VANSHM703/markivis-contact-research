import { SubmitButton } from "@/components/forms/SubmitButton";
import { SOURCE_TYPE_LABELS } from "@/components/ui/Priority";
import { withWorkspace } from "@/db/client";
import { BATCH_MINUTES, REVIEW_MINUTES, shadowReport, SHADOW_DAYS } from "@/domain/shadow";
import { formatDate } from "@/lib/format/labels";
import { promoteShadowAction, startShadowRunAction } from "@/server/shadow-actions";
import styles from "./Queue.module.css";

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** The shadow run report (BRD 24.1), with start and go-live for platform admins. */
export async function ShadowRunCard({ workspaceId, isPlatformAdmin, now }: { workspaceId: string; isPlatformAdmin: boolean; now: Date }) {
  const report = await withWorkspace(workspaceId, (tx) => shadowReport(tx, workspaceId, now));
  const hours = report.budgetMinutesPerWeek / 60;
  return (
    <section className={`card ${styles.shadowCard}`} aria-labelledby="shadow-heading">
      <div className={styles.shadowHead}>
        <div>
          <h2 id="shadow-heading" className="t-heading-card">Shadow run</h2>
          <p className="t-caption t-muted">
            {report.on
              ? `Running${report.startedAt ? ` since ${formatDate(report.startedAt)}` : ""}${report.endsOn ? `, ${SHADOW_DAYS} days to ${formatDate(report.endsOn)}` : ""}. New signals are seen only by validators and platform admins.`
              : report.signals
                ? "Not running. The figures below are from the last run."
                : `Not running. A ${SHADOW_DAYS}-day shadow run sizes the validation workload before anyone else sees signals.`}
          </p>
        </div>
        {isPlatformAdmin ? (
          report.on ? (
            <form action={promoteShadowAction}>
              <SubmitButton>Go live</SubmitButton>
            </form>
          ) : (
            <form action={startShadowRunAction}>
              <SubmitButton variant="ghost">Start shadow run</SubmitButton>
            </form>
          )
        ) : null}
      </div>

      <dl className={styles.facts}>
        <div><dt>Projected review time</dt><dd>{report.projectedMinutesPerWeek} minutes a week</dd></div>
        <div><dt>Validator time available</dt><dd>{hours} {hours === 1 ? "hour" : "hours"} a week ({report.budgetMinutesPerWeek} minutes)</dd></div>
        <div><dt>Go criterion</dt><dd>{report.signals === 0 ? "No signals yet" : report.goCriterionMet ? "Met: the projection fits the validator's time" : "Not met: tighten feeds and run 7 more days"}</dd></div>
        <div><dt>Auto-confirm share</dt><dd>{report.signals ? pct(report.autoConfirmShare) : "n/a"} of {report.signals} signals</dd></div>
      </dl>
      <p className="t-caption t-muted">Review items count {REVIEW_MINUTES} minutes each and weekly batch items {BATCH_MINUTES} minutes each. At go-live, shadow signals from the last 7 days move into their lanes and older ones are discarded.</p>

      {report.weeks.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.changes}>
            <caption className="visually-hidden">Raw items and signals per week</caption>
            <thead>
              <tr><th scope="col">Week of</th><th scope="col">Raw items</th><th scope="col">Signals</th><th scope="col">Auto</th><th scope="col">Review</th><th scope="col">Batch</th><th scope="col">P1</th><th scope="col">P2</th><th scope="col">P3</th></tr>
            </thead>
            <tbody>
              {report.weeks.map((w) => (
                <tr key={w.week}>
                  <th scope="row">{formatDate(w.week)}</th>
                  <td>{w.rawItems}</td>
                  <td>{w.signals}</td>
                  <td>{w.lanes.auto_confirm}</td>
                  <td>{w.lanes.review + w.lanes.more_research}</td>
                  <td>{w.lanes.weekly_batch}</td>
                  <td>{w.priorities[1]}</td>
                  <td>{w.priorities[2]}</td>
                  <td>{w.priorities[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {report.rejectByFeed.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.changes}>
            <caption className="visually-hidden">Reject share by feed</caption>
            <thead>
              <tr><th scope="col">Feed</th><th scope="col">Signals</th><th scope="col">Rejected</th><th scope="col">Reject share</th></tr>
            </thead>
            <tbody>
              {report.rejectByFeed.map((f) => (
                <tr key={f.sourceType}>
                  <th scope="row">{SOURCE_TYPE_LABELS[f.sourceType] ?? f.sourceType}</th>
                  <td>{f.signals}</td>
                  <td>{f.rejected}</td>
                  <td>{pct(f.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
