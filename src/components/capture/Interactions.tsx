/** The Interactions tab (BRD 16.2): a timeline of captured and logged activity with a person. */
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Chip } from "@/components/ui/Chip";
import { formatDateIn, formatTimeIn } from "@/lib/format/labels";
import { can } from "@/lib/permissions";
import type { RequestContext } from "@/lib/context";
import { interactionsFor } from "@/server/capture";
import { setPersonPrivateAction, setThreadPrivateAction } from "@/server/capture-actions";
import styles from "@/app/(app)/record.module.css";

const CHANNEL: Record<string, string> = {
  email: "Email", meeting: "Meeting", call: "Call", linkedin_request: "LinkedIn request", linkedin_message: "LinkedIn message", event: "Event",
  interview: "Interview", newsletter_click: "Newsletter click", newsletter_open: "Newsletter open", download: "Download", note: "Note",
};
const DIRECTION: Record<string, string> = { outbound: "Sent", inbound: "Received", two_way: "Both ways", not_applicable: "" };

export async function Interactions({ ctx, personId }: { ctx: RequestContext; personId: string }) {
  const { rows, total, personPrivate } = await interactionsFor(ctx, personId);
  const partner = can(ctx.role, "privacy.mark_private");
  const tz = ctx.workspace.timezone;
  return (
    <section className="card" aria-labelledby="interactions-heading">
      <div className={styles.tableHeader}>
        <h2 id="interactions-heading" className="t-heading-card">Interactions <span className="t-meta t-muted">{total}</span></h2>
        {partner ? (
          <form action={setPersonPrivateAction.bind(null, personId, !personPrivate)}>
            <SubmitButton variant="ghost" compact>{personPrivate ? "Make contact visible to the team" : "Mark contact private"}</SubmitButton>
          </form>
        ) : null}
      </div>
      {personPrivate ? <p className="t-caption t-muted">This contact is private: only partners see subjects and summaries. Every interaction still counts toward the relationship score.</p> : null}
      {rows.length === 0 ? <p className="t-caption t-muted">No interactions yet. Connect your mailbox in Settings, or log one.</p> : null}
      <ol className={styles.timeline}>
        {rows.map((r) => (
          <li key={r.id}>
            <p className={styles.itemTitle}>
              {CHANNEL[r.channel] ?? r.channel}
              {DIRECTION[r.direction] ? <span className="t-muted">, {DIRECTION[r.direction]!.toLowerCase()}</span> : null}
              {r.isPrivate ? <Chip>Private</Chip> : null}
            </p>
            <p className="t-meta t-muted">
              {formatDateIn(r.occurredAt, tz)} {formatTimeIn(r.occurredAt, tz)}
              {r.ourUserName ? ` · ${r.ourUserName}` : ""}
              {r.capturedBy === "auto" ? " · captured" : r.capturedBy === "manual" ? " · logged" : ""}
            </p>
            {r.subject ? <p className="t-caption">{r.subject}</p> : null}
            {r.summary ? <p className="t-caption t-muted">{r.summary}</p> : null}
            {r.hidden ? <p className="t-caption t-muted">Details are private.</p> : null}
            {partner && r.threadKey ? (
              <form action={setThreadPrivateAction.bind(null, personId, r.threadKey, !r.threadPrivate)}>
                <SubmitButton variant="ghost" compact>{r.threadPrivate ? "Make thread visible" : "Mark thread private"}</SubmitButton>
              </form>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
