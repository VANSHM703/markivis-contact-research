import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "@/components/forms/Form.module.css";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { dueDate } from "@/domain/actions";
import { ACTION_TYPE_LABELS } from "@/lib/format/labels";
import { execSearchOn } from "@/lib/packs";
import { localDate } from "@/lib/working-days";
import { createActionForPersonAction } from "@/server/action-actions";
import { listOwners } from "@/server/actions";
import { getPerson } from "@/server/records";
import { allowed, pageContext, requireUuid } from "@/server/guards";

export const metadata: Metadata = { title: "Create action" };

/** "Create action" from a person page (BRD 12.1). The pre-action checks run when it is saved. */
export default async function NewActionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "messages.send")) return <PermissionDenied who="partners and outreach owners" />;
  const { id } = await params;
  requireUuid(id);
  const record = await getPerson(ctx.workspace.id, id);
  if (!record || record.mergedInto) notFound();
  const owners = await listOwners(ctx.workspace.id);
  const defaultOwner = record.person.relationshipOwnerId ?? ctx.user.id;
  const defaultDue = localDate(dueDate({ priority: 2, type: "other", effectiveOn: null }, new Date(), ctx.workspace.settings, ctx.workspace.timezone), ctx.workspace.timezone);

  return (
    <>
      <PageHeader title={`Create an action for ${record.person.fullName}`} lede="The draft is written as soon as you save, unless a consent or off-limits check blocks it." />
      <form action={createActionForPersonAction.bind(null, record.person.id)} className={styles.stack}>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span className={styles.label}>Action</span>
            <select name="type" defaultValue="check_in" className={styles.input}>
              {Object.entries(ACTION_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {execSearchOn(ctx.workspace) ? (
          <label className={styles.field}>
            <span className={styles.label}>Approach</span>
            <select name="purpose" defaultValue="client" className={styles.input}>
              <option value="client">Client</option>
              <option value="candidate">Candidate</option>
            </select>
            <span className={styles.help}>Candidate approaches are blocked where the employer is off-limits.</span>
          </label>
          ) : null}
          <label className={styles.field}>
            <span className={styles.label}>Owner</span>
            <select name="owner" defaultValue={defaultOwner} className={styles.input}>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Due date</span>
            <input type="date" name="due" defaultValue={defaultDue} className={styles.input} />
            <span className={styles.help}>Defaults to the priority 2 service level.</span>
          </label>
          <label className={`${styles.field} ${styles.wide}`}>
            <span className={styles.label}>Headline (optional)</span>
            <input name="headline" maxLength={140} className={styles.input} placeholder="For example: Follow up after the board dinner" />
          </label>
        </div>
        <div className={styles.actions}>
          <SubmitButton>Create action</SubmitButton>
          <Link href={`/people/${record.person.id}`} className="btn btn--ghost">Cancel</Link>
        </div>
      </form>
    </>
  );
}
