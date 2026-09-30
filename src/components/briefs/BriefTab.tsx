/** The Brief tab (BRD 12.6): the latest brief for the person, or the one a digest linked to. */
import { and, desc, eq } from "drizzle-orm";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Markdown } from "@/components/ui/Markdown";
import { withWorkspace } from "@/db/client";
import { briefs, calendarEvents } from "@/db/schema";
import { formatDateIn, formatTimeIn } from "@/lib/format/labels";
import { prepareBriefAction } from "@/server/brief-actions";
import { UUID_RE } from "@/server/guards";
import styles from "./Brief.module.css";

export async function BriefTab({ workspaceId, personId, briefId, tz, canPrepare }: { workspaceId: string; personId: string; briefId?: string; tz: string; canPrepare: boolean }) {
  const brief = await withWorkspace(workspaceId, async (tx) => {
    const where = briefId && UUID_RE.test(briefId) ? and(eq(briefs.personId, personId), eq(briefs.id, briefId)) : eq(briefs.personId, personId);
    const [row] = await tx
      .select({ id: briefs.id, md: briefs.contentMarkdown, generatedAt: briefs.generatedAt, model: briefs.model, eventTitle: calendarEvents.title, eventAt: calendarEvents.startsAt })
      .from(briefs)
      .leftJoin(calendarEvents, eq(calendarEvents.id, briefs.calendarEventId))
      .where(where)
      .orderBy(desc(briefs.generatedAt))
      .limit(1);
    return row ?? null;
  });
  return (
    <section className={`card ${styles.brief}`} aria-labelledby="brief-heading">
      <div className={styles.head}>
        <h2 id="brief-heading" className="t-heading-card">Meeting brief</h2>
        {canPrepare ? (
          <form action={prepareBriefAction.bind(null, personId)}>
            <SubmitButton variant="ghost" compact>{brief ? "Prepare a new brief" : "Prepare a brief"}</SubmitButton>
          </form>
        ) : null}
      </div>
      {brief ? (
        <>
          <p className="t-meta t-muted">
            {brief.eventTitle && brief.eventAt ? `For ${brief.eventTitle}, ${formatDateIn(brief.eventAt, tz)} at ${formatTimeIn(brief.eventAt, tz)}. ` : ""}
            Written {formatDateIn(brief.generatedAt, tz)} {formatTimeIn(brief.generatedAt, tz)}{brief.model === "mock" ? " (mock)" : ""}. Check it before relying on it.
          </p>
          <div className={styles.body}>
            <Markdown text={brief.md} />
          </div>
        </>
      ) : (
        <p className="t-caption t-muted">No brief yet. Briefs are written automatically the day before a meeting with this person, or on request.</p>
      )}
    </section>
  );
}
