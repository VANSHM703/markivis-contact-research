import Link from "next/link";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Notice } from "@/components/ui/Notice";
import { SOURCE_TYPE_LABELS } from "@/components/ui/Priority";
import { can } from "@/lib/permissions";
import { suspendedSourceTypes } from "@/pipeline/validation";
import { reenableAutoConfirmAction } from "@/server/queue-actions";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReadoutBand } from "@/components/ui/ReadoutBand";
import { getRequestContext } from "@/lib/context";
import { getTodayFigures, workingDaysBetween } from "@/server/today";
import styles from "./page.module.css";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  const now = new Date();
  const f = await getTodayFigures(ctx.workspace.id, ctx.user.id, now);
  const oldestAge = f.oldestQueueItemAt ? workingDaysBetween(f.oldestQueueItemAt, now) : 0;
  const nothingToDo = f.actionsDueToday + f.actionsOverdue + f.draftsAwaitingApproval + f.queueItems === 0;
  const { notice } = await searchParams;
  const suspended = suspendedSourceTypes(ctx.workspace.settings);
  const canReenable = can(ctx.role, "settings.change");

  return (
    <>
      <Notice notice={notice} />
      <PageHeader title="Today" lede={`What needs you today in ${ctx.workspace.name}, in order.`} />
      <div className={styles.stack}>
        <ReadoutBand
          label="Today at a glance"
          figures={[
            { label: "Actions due today", value: String(f.actionsDueToday), overTarget: f.actionsOverdue > 0 },
            { label: "Drafts awaiting approval", value: String(f.draftsAwaitingApproval) },
            { label: "Items in the queue", value: String(f.queueItems) },
            { label: "Oldest item, working days", value: String(oldestAge), overTarget: oldestAge > 3 },
          ]}
        />
        {suspended.map((sus) => (
          <section key={sus.sourceType} className={`card ${styles.alert}`} aria-label="Auto-confirm suspended">
            <p className="t-eyebrow">Auto-confirm suspended</p>
            <p>
              {SOURCE_TYPE_LABELS[sus.sourceType] ?? sus.sourceType}: auto-confirm has been off since {new Date(sus.since).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, because spot checks found errors above the limit. New items from this source wait for review.
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
      </div>
    </>
  );
}
