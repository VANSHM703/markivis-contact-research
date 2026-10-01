import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/components/compliance/Compliance.module.css";
import { SuppressionCheck } from "@/components/compliance/SuppressionCheck";
import formStyles from "@/components/forms/Form.module.css";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { SUPPRESSION_REASON_LABELS } from "@/lib/format/labels";
import { addSuppressionAction, removeSuppressionAction } from "@/server/compliance-actions";
import { getSuppressionOverview } from "@/server/compliance";
import { allowed, pageContext } from "@/server/guards";

export const metadata: Metadata = { title: "Consent and suppression" };

export default async function ConsentSettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "compliance.manage")) return <PermissionDenied who="data stewards" />;
  const { notice } = await searchParams;
  const counts = await getSuppressionOverview(ctx.workspace.id);
  const total = counts.erasure + counts.opt_out + counts.do_not_contact;

  return (
    <>
      <Notice notice={notice} />
      <PageHeader title="Consent and suppression" lede="The suppression list overrides every other rule: no import, source or person can bring a suppressed address back. It holds salted hashes only, so it cannot be read as a list of addresses." />
      <p className={`t-caption ${styles.back}`}><Link href="/settings">Back to Settings</Link></p>
      <div className={styles.stack}>
        <section className="card" aria-labelledby="counts-heading">
          <h2 id="counts-heading" className="t-heading-card">On the list</h2>
          <dl className={styles.figures}>
            <div><dt>All entries</dt><dd>{total}</dd></div>
            {(["opt_out", "do_not_contact", "erasure"] as const).map((r) => (
              <div key={r}><dt>{SUPPRESSION_REASON_LABELS[r]}</dt><dd>{counts[r]}</dd></div>
            ))}
          </dl>
          <p className="t-caption t-muted">Consent and lawful basis for one person are on their page, under Consent and privacy. So are do not contact, the access export and erasure.</p>
        </section>

        <section className="card" aria-labelledby="check-heading">
          <h2 id="check-heading" className="t-heading-card">Check an address</h2>
          <SuppressionCheck />
        </section>

        <section className="card" aria-labelledby="add-heading">
          <h2 id="add-heading" className="t-heading-card">Add or remove an address</h2>
          <p className="t-caption t-muted">For an opt-out or do-not-contact request that arrived elsewhere, for example by phone. Erasure entries come only from erasing a person, and stay for good.</p>
          <form action={addSuppressionAction} className={formStyles.stack}>
            <div className={formStyles.grid}>
              <label className={formStyles.field}>
                <span className={formStyles.label}>Email address or LinkedIn profile URL</span>
                <input name="value" required autoComplete="off" className={formStyles.input} />
              </label>
              <label className={formStyles.field}>
                <span className={formStyles.label}>Reason</span>
                <select name="reason" defaultValue="opt_out" className={formStyles.input}>
                  <option value="opt_out">{SUPPRESSION_REASON_LABELS.opt_out}</option>
                  <option value="do_not_contact">{SUPPRESSION_REASON_LABELS.do_not_contact}</option>
                </select>
              </label>
            </div>
            <div className={formStyles.actions}>
              <SubmitButton>Add to the list</SubmitButton>
            </div>
          </form>
          <form action={removeSuppressionAction} className={formStyles.stack}>
            <div className={styles.row}>
              <label className={formStyles.field}>
                <span className={formStyles.label}>Remove an opt-out or do-not-contact entry</span>
                <input name="value" required autoComplete="off" className={formStyles.input} />
              </label>
              <SubmitButton variant="ghost">Remove</SubmitButton>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
