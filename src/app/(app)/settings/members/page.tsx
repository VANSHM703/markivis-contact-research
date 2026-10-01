import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/components/compliance/Compliance.module.css";
import formStyles from "@/components/forms/Form.module.css";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { StatePill } from "@/components/ui/Priority";
import { DataTable } from "@/components/ui/DataTable";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { withWorkspace } from "@/db/client";
import { listMembers, ROLES } from "@/domain/members";
import { formatDateIn, ROLE_LABELS } from "@/lib/format/labels";
import { changeRoleAction, inviteMemberAction, removeMemberAction } from "@/server/member-actions";
import { allowed, pageContext } from "@/server/guards";

export const metadata: Metadata = { title: "Members and roles" };

const ROLE_NOTES: Record<string, string> = {
  partner: "Everything, including approving drafts, mandate notes and off-limits.",
  outreach_owner: "Works actions and sends from their own mailbox.",
  validator: "Works the queue: confirms, rejects and merges.",
  account_lead: "Reads records only.",
  data_steward: "Consent, suppression, erasure, export, members and the audit log.",
};

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "members.manage") || ctx.breakGlass) return <PermissionDenied who="partners and data stewards" />;
  const { notice } = await searchParams;
  const members = await withWorkspace(ctx.workspace.id, (tx) => listMembers(tx));
  const tz = ctx.workspace.timezone;

  return (
    <>
      <Notice notice={notice} />
      <PageHeader title="Members and roles" lede="Who can open this workspace, and what each person can do. Every change is written to the audit log." />
      <p className={`t-caption ${styles.back}`}><Link href="/settings">Back to Settings</Link></p>
      <div className={styles.stack}>
        <DataTable
          caption="Members"
          columns={[{ key: "name", label: "Member" }, { key: "role", label: "Role" }, { key: "status", label: "Status" }, { key: "remove", label: "Access" }]}
          rows={members.map((m) => {
            const self = m.userId === ctx.user.id;
            const removed = m.status === "removed";
            return {
              id: m.memberId,
              cells: {
                name: (
                  <>
                    <span className="cell-title">{m.name}{self ? " (you)" : ""}</span>
                    <span className="cell-sub">{m.email}</span>
                    <span className="cell-sub">{m.lastSignInAt ? `Last signed in ${formatDateIn(m.lastSignInAt, tz)}` : "Not signed in yet"}</span>
                  </>
                ),
                role: self || removed ? (
                  ROLE_LABELS[m.role]
                ) : (
                  <form action={changeRoleAction.bind(null, m.memberId)} className={styles.cellActions}>
                    <label className="visually-hidden" htmlFor={`role-${m.memberId}`}>Role for {m.name}</label>
                    <select id={`role-${m.memberId}`} name="role" defaultValue={m.role} className={`${formStyles.input} ${styles.select}`}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                    <SubmitButton variant="ghost" compact>Change</SubmitButton>
                  </form>
                ),
                status: m.status === "active" ? <StatePill tone="ok">Active</StatePill> : m.status === "invited" ? <StatePill tone="neutral">Invited</StatePill> : <StatePill tone="warn">Removed</StatePill>,
                remove: self || removed ? "" : (
                  <form action={removeMemberAction.bind(null, m.memberId)}>
                    <SubmitButton variant="danger" compact>Remove</SubmitButton>
                  </form>
                ),
              },
            };
          })}
        />

        <section className="card" aria-labelledby="invite-heading">
          <h2 id="invite-heading" className="t-heading-card">Invite someone</h2>
          <p className="t-caption t-muted">They get an email with a sign-in link and join when they first sign in with that work address.</p>
          <form action={inviteMemberAction} className={formStyles.stack}>
            <div className={formStyles.grid}>
              <label className={formStyles.field}>
                <span className={formStyles.label}>Work email</span>
                <input type="email" name="email" required autoComplete="off" className={formStyles.input} />
              </label>
              <label className={formStyles.field}>
                <span className={formStyles.label}>Name</span>
                <input name="name" autoComplete="off" className={formStyles.input} />
                <span className={formStyles.help}>Optional. Taken from their account at first sign-in.</span>
              </label>
              <fieldset className={`${formStyles.fieldset} ${formStyles.field} ${formStyles.wide}`}>
                <legend className={formStyles.label}>Role</legend>
                <div className={styles.plain}>
                  {ROLES.map((r) => (
                    <label key={r} className={formStyles.check}>
                      <input type="radio" name="role" value={r} defaultChecked={r === "account_lead"} required />
                      <span><strong>{ROLE_LABELS[r]}</strong>. <span className="t-caption t-muted">{ROLE_NOTES[r]}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <div className={formStyles.actions}>
              <SubmitButton>Send invitation</SubmitButton>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
