import type { Metadata } from "next";
import { ImportForm } from "@/components/records/ImportForm";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { APP_BASE_PATH } from "@/config/product";
import { TARGET_LIST_COLUMNS } from "@/domain/imports/target-list";
import { uploadTargetListAction } from "@/server/import-actions";
import { allowed, pageContext } from "@/server/guards";
import styles from "../../record.module.css";

export const metadata: Metadata = { title: "Import target list" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "records.edit")) return <PermissionDenied who="partners, outreach owners and validators" />;
  const { notice } = await searchParams;
  return (
    <>
      <Notice notice={notice} />
      <PageHeader
        title="Import target list"
        lede="Companies, and the people at them, from one CSV file. You see what will happen to every row before anything is saved."
        actions={
          // A plain link: the template is a file download from an API route.
          <a href={`${APP_BASE_PATH}/api/v1/imports/template`} className="btn btn--ghost" download>
            Download template
          </a>
        }
      />
      <div className={styles.columns}>
        <ImportForm action={uploadTargetListAction} />
        <section className="card" aria-labelledby="columns-heading">
          <h2 id="columns-heading" className="t-heading-card">Columns</h2>
          <p className="t-caption t-muted">Only company_name is required. Column names are not case sensitive, and other columns are ignored.</p>
          <dl className={styles.columnList}>
            {TARGET_LIST_COLUMNS.map((c) => (
              <div key={c.key}>
                <dt className="t-meta">
                  {c.key}
                  {c.required === "always" ? <span className={styles.required}> required</span> : c.required === "with_person" ? <span className="t-muted"> needed for a person</span> : null}
                </dt>
                <dd className="t-caption t-muted">{c.description}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}
