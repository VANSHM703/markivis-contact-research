import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/components/compliance/Compliance.module.css";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { KEEP_MONTHS, RETENTION_MONTHS } from "@/domain/retention";
import { formatDate, formatDateIn } from "@/lib/format/labels";
import { keepInRetentionAction } from "@/server/compliance-actions";
import { getRetentionReview } from "@/server/compliance";
import { allowed, pageContext } from "@/server/guards";

export const metadata: Metadata = { title: "Retention review" };

export default async function RetentionPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "compliance.manage")) return <PermissionDenied who="data stewards" />;
  const { notice } = await searchParams;
  const { rows, total } = await getRetentionReview(ctx.workspace.id);
  const tz = ctx.workspace.timezone;

  return (
    <>
      <Notice notice={notice} />
      <PageHeader title="Retention review" lede={`People with no current role and no interaction for ${RETENTION_MONTHS} months. Keep someone to take them off the list for ${KEEP_MONTHS} months, or erase them. The list is emailed to you on the first Monday of each month.`} />
      <p className={`t-caption ${styles.back}`}><Link href="/settings">Back to Settings</Link></p>
      {rows.length === 0 ? (
        <EmptyState message="Nobody to review. Everyone without a current role has been in touch in the last two years, or was kept recently." />
      ) : (
        <>
          <p className="t-caption t-muted">{total} {total === 1 ? "person" : "people"} to review{total > rows.length ? `, the first ${rows.length} shown` : ""}.</p>
          <DataTable
            caption="People to keep or erase"
            columns={[{ key: "name", label: "Person" }, { key: "left", label: "Last role ended", numeric: true }, { key: "contact", label: "Last interaction", numeric: true }, { key: "decide", label: "Decision" }]}
            rows={rows.map((r) => ({
              id: r.id,
              cells: {
                name: <Link href={`/people/${r.id}`}>{r.fullName}</Link>,
                left: r.lastRoleEndedOn ? formatDate(r.lastRoleEndedOn) : "Unknown",
                contact: r.lastInteractionAt ? formatDateIn(r.lastInteractionAt, tz) : "Never",
                decide: (
                  <div className={styles.cellActions}>
                    <form action={keepInRetentionAction.bind(null, r.id)}>
                      <SubmitButton variant="ghost" compact>Keep</SubmitButton>
                    </form>
                    <Link href={`/people/${r.id}?tab=privacy`} className="btn btn--danger btn--compact">Erase</Link>
                  </div>
                ),
              },
            }))}
          />
        </>
      )}
    </>
  );
}
