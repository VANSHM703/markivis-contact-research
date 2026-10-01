import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/components/compliance/Compliance.module.css";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { APP_BASE_PATH } from "@/config/product";
import { allowed, pageContext } from "@/server/guards";

export const metadata: Metadata = { title: "Data export" };

export default async function ExportPage() {
  const ctx = await pageContext();
  if (!allowed(ctx, "data.export_all")) return <PermissionDenied who="data stewards" />;
  return (
    <>
      <PageHeader title="Data export" lede={`${ctx.workspace.name} owns its data. Download all of it at any time.`} />
      <p className={`t-caption ${styles.back}`}><Link href="/settings">Back to Settings</Link></p>
      <div className={styles.stack}>
        <section className="card" aria-labelledby="export-heading">
          <h2 id="export-heading" className="t-heading-card">Full workspace export</h2>
          <p>One ZIP file with every table as CSV and as JSON, and a schema description of every column and value list.</p>
          <ul className={styles.counts}>
            <li>Timestamps are in UTC.</li>
            <li>Left out on purpose: mailbox access tokens, stored credentials and the suppression salt.</li>
            <li>The download starts at once and streams while it is built; a large workspace takes a few minutes.</li>
            <li>Each export is written to the audit log.</li>
          </ul>
          <p>
            <a href={`${APP_BASE_PATH}/api/v1/exports/workspace`} className="btn btn--primary" download>Download the workspace</a>
          </p>
          <p className="t-caption t-muted">To export one person for an access request, open their page, then Consent and privacy.</p>
        </section>
      </div>
    </>
  );
}
