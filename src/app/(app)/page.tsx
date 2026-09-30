import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReadoutBand } from "@/components/ui/ReadoutBand";
import { getRequestContext } from "@/lib/context";
import { getTodayFigures, workingDaysBetween } from "@/server/today";
import styles from "./page.module.css";

export default async function TodayPage() {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  const now = new Date();
  const f = await getTodayFigures(ctx.workspace.id, ctx.user.id, now);
  const oldestAge = f.oldestQueueItemAt ? workingDaysBetween(f.oldestQueueItemAt, now) : 0;
  const nothingToDo = f.actionsDueToday + f.actionsOverdue + f.draftsAwaitingApproval + f.queueItems === 0;

  return (
    <>
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
        {nothingToDo ? <EmptyState message="Nothing needs you today. New changes appear here as they are confirmed." /> : null}
      </div>
    </>
  );
}
