import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/components/compliance/Compliance.module.css";
import formStyles from "@/components/forms/Form.module.css";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { DataTable } from "@/components/ui/DataTable";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { DISMISS_REASON_LABELS, SIGNAL_TYPE_LABELS } from "@/lib/format/labels";
import { savePrioritiesAction } from "@/server/settings-actions";
import { getSignalPriorities } from "@/server/compliance";
import { allowed, pageContext } from "@/server/guards";

export const metadata: Metadata = { title: "Signal priorities" };

export default async function PrioritiesPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "settings.change")) return <PermissionDenied who="partners and data stewards" />;
  const { notice } = await searchParams;
  const rows = await getSignalPriorities(ctx.workspace.id);

  return (
    <>
      <Notice notice={notice} />
      <PageHeader title="Signal priorities" lede="The priority each type of signal gets. Priority sets the queue order, the lane (priority 3 goes to the weekly batch) and the due date of its action. A placed executive's moves stay priority 1 whatever is set here." />
      <p className={`t-caption ${styles.back}`}><Link href="/settings">Back to Settings</Link></p>
      <form action={savePrioritiesAction} className={styles.stack}>
        <DataTable
          caption="Priority and dismissals by signal type, last 90 days"
          columns={[{ key: "type", label: "Signal type" }, { key: "priority", label: "Priority" }, { key: "confirmed", label: "Confirmed", numeric: true }, { key: "dismissed", label: "Actions dismissed", numeric: true }, { key: "why", label: "Why dismissed" }]}
          rows={rows.map((r) => ({
            id: r.type,
            cells: {
              type: (
                <>
                  <span className="cell-title">{SIGNAL_TYPE_LABELS[r.type] ?? r.type}</span>
                  <span className="cell-sub">Default priority {r.defaultPriority}</span>
                </>
              ),
              priority: (
                <>
                  <label className="visually-hidden" htmlFor={`priority_${r.type}`}>Priority for {SIGNAL_TYPE_LABELS[r.type] ?? r.type}</label>
                  <select id={`priority_${r.type}`} name={`priority_${r.type}`} defaultValue={r.overridden ? String(r.priority) : "default"} className={`${formStyles.input} ${styles.select}`}>
                    <option value="default">Default (P{r.defaultPriority})</option>
                    {[1, 2, 3].map((p) => <option key={p} value={p}>P{p}</option>)}
                  </select>
                </>
              ),
              confirmed: r.confirmed,
              dismissed: r.actions ? `${r.dismissed} of ${r.actions}` : "0",
              why: Object.keys(r.dismissedBy).length ? Object.entries(r.dismissedBy).map(([k, n]) => `${DISMISS_REASON_LABELS[k] ?? k} ${n}`).join(", ") : "None",
            },
          }))}
        />
        <p className="t-caption t-muted">A type whose actions are often dismissed as not relevant is a candidate for a lower priority. Changes apply to new signals.</p>
        <div className={formStyles.actions}>
          <SubmitButton>Save priorities</SubmitButton>
        </div>
      </form>
    </>
  );
}
