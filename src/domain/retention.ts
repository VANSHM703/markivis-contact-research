/**
 * Retention review (BRD 18.2): each month, the data steward gets the people with no current role
 * and no interaction for 24 months, to keep or erase. Keeping someone takes them off the list for
 * 12 months, after which they come back if nothing has changed.
 */
import { eq, sql } from "drizzle-orm";
import { withWorkspace, type Tx } from "@/db/client";
import { persons } from "@/db/schema";
import { audit } from "@/lib/audit";
import { appLink, EMAIL_FOOTER, membersWithRoles, queueNotification } from "@/mail/notify";
import type { Actor } from "./records";

export const RETENTION_MONTHS = 24;
export const KEEP_MONTHS = 12;

export interface RetentionCandidate {
  id: string;
  fullName: string;
  lastInteractionAt: Date | null;
  lastRoleEndedOn: string | null;
  reviewedAt: Date | null;
}

const monthsBefore = (now: Date, months: number) => {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
};

export async function retentionCandidates(tx: Tx, now = new Date(), limit = 200): Promise<{ rows: RetentionCandidate[]; total: number }> {
  const quietSince = monthsBefore(now, RETENTION_MONTHS).toISOString();
  const keptSince = monthsBefore(now, KEEP_MONTHS).toISOString();
  const result = await tx.execute<{ id: string; full_name: string; last_interaction_at: string | null; last_role_ended_on: string | null; reviewed_at: string | null; total: number }>(sql`
    select p.id, p.full_name, p.retention_reviewed_at as reviewed_at,
           (select max(i.occurred_at) from dmi.interactions i where i.person_id = p.id) as last_interaction_at,
           (select max(r.ended_on) from dmi.roles r where r.person_id = p.id) as last_role_ended_on,
           count(*) over ()::int as total
    from dmi.persons p
    where p.status = 'no_current_role' and p.merged_into_id is null
      and (p.retention_reviewed_at is null or p.retention_reviewed_at < ${keptSince}::timestamptz)
      and not exists (select 1 from dmi.interactions i where i.person_id = p.id and i.occurred_at >= ${quietSince}::timestamptz)
    order by last_interaction_at asc nulls first, p.full_name
    limit ${limit}`);
  return {
    total: result.rows[0]?.total ?? 0,
    rows: result.rows.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      lastInteractionAt: r.last_interaction_at ? new Date(r.last_interaction_at) : null,
      lastRoleEndedOn: r.last_role_ended_on ? String(r.last_role_ended_on).slice(0, 10) : null,
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : null,
    })),
  };
}

/** The steward keeps the record: it leaves the review for 12 months. */
export async function keepInRetention(tx: Tx, actor: Actor, personId: string, now = new Date()): Promise<void> {
  const [row] = await tx.update(persons).set({ retentionReviewedAt: now }).where(eq(persons.id, personId)).returning({ id: persons.id });
  if (!row) throw new Error("Person not found.");
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: actor.kind ?? "user", action: "retention.kept", entityType: "person", entityId: personId, after: { until: monthsBefore(now, -KEEP_MONTHS).toISOString().slice(0, 10) } });
}

/** The monthly job: tells each data steward how many people are waiting for a decision. */
export async function runRetentionReview(workspaceId: string, now = new Date()): Promise<{ candidates: number; notified: number }> {
  return withWorkspace(workspaceId, async (tx) => {
    const { total } = await retentionCandidates(tx, now, 1);
    if (total === 0) return { candidates: 0, notified: 0 };
    const month = now.toISOString().slice(0, 7);
    let notified = 0;
    for (const steward of await membersWithRoles(tx, ["data_steward"])) {
      const queued = await queueNotification(tx, {
        workspaceId,
        userId: steward.userId,
        toEmail: steward.email,
        kind: "retention_review",
        dedupeKey: `retention:${month}:${steward.userId}`,
        subject: `Retention review: ${total} ${total === 1 ? "person" : "people"} to keep or erase`,
        bodyText: `${total} ${total === 1 ? "person has" : "people have"} had no current role and no interaction for ${RETENTION_MONTHS} months. Keep or erase each one:\n${appLink("/settings/retention")}${EMAIL_FOOTER}`,
      });
      if (queued) notified++;
    }
    return { candidates: total, notified };
  });
}
