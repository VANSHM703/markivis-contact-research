import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Chip } from "@/components/ui/Chip";
import { DataTable } from "@/components/ui/DataTable";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { ReadoutBand } from "@/components/ui/ReadoutBand";
import { withWorkspace } from "@/db/client";
import { importBatches } from "@/db/schema";
import type { ImportReport, PersonOutcome } from "@/domain/imports/target-list";
import { commitImportAction, discardImportAction, type StoredBatch } from "@/server/import-actions";
import { allowed, pageContext, requireUuid } from "@/server/guards";
import styles from "../../../record.module.css";

export const metadata: Metadata = { title: "Import preview" };

const PERSON_OUTCOME: Record<PersonOutcome, { label: string; tone?: "blocked" }> = {
  new: { label: "New person" },
  matched: { label: "Matches an existing person" },
  possible_duplicate: { label: "Possible duplicate: goes to the queue" },
  suppressed: { label: "Suppressed: will be skipped", tone: "blocked" },
  in_file_duplicate: { label: "Repeats an earlier row" },
};

export default async function ImportBatchPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<{ notice?: string; show?: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "records.edit")) return <PermissionDenied who="partners, outreach owners and validators" />;
  const { batchId } = await params;
  requireUuid(batchId);
  const { notice, show } = await searchParams;
  const [batch] = await withWorkspace(ctx.workspace.id, (tx) => tx.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1));
  if (!batch) notFound();
  const stored = batch.rows as StoredBatch;
  const { summary } = stored;
  const problemsOnly = show === "problems";
  const rows = problemsOnly ? stored.rows.filter((r) => r.issues.length > 0 || r.person === "suppressed" || r.person === "possible_duplicate") : stored.rows;
  const report = batch.report as ImportReport | null;

  if (batch.status === "committed" && report) {
    return (
      <>
        <Notice notice={notice} />
        <PageHeader title="Import complete" lede={`${batch.filename}: ${summary.rows} rows processed.`} actions={<Link href="/people" className="btn btn--primary">Open people</Link>} />
        <div className={styles.stack}>
          <ReadoutBand
            label="Import result"
            figures={[
              { label: "People created", value: String(report.peopleCreated) },
              { label: "People matched", value: String(report.peopleMatched) },
              { label: "Companies created", value: String(report.companiesCreated) },
              { label: "Rows rejected", value: String(report.rejected.length) },
            ]}
          />
          <section className="card">
            <dl className={styles.readout}>
              <div><dt>Companies matched</dt><dd className="t-meta">{report.companiesMatched}</dd></div>
              <div><dt>Possible duplicates sent to the queue</dt><dd className="t-meta">{report.possibleDuplicates}</dd></div>
              <div><dt>Conflicting values sent to the queue</dt><dd className="t-meta">{report.conflicts}</dd></div>
            </dl>
            {report.possibleDuplicates + report.conflicts > 0 ? (
              <p className={`${styles.warnLine} ${styles.spaced}`}>
                {report.possibleDuplicates + report.conflicts} items are waiting for a validator. <Link href="/queue?tab=conflicts">Open conflicts and duplicates</Link>
              </p>
            ) : null}
          </section>
          {report.rejected.length > 0 ? (
            <DataTable
              caption="Rejected rows"
              columns={[{ key: "row", label: "Row" }, { key: "reason", label: "Reason" }]}
              rows={report.rejected.map((r) => ({ id: String(r.rowNumber), cells: { row: <span className="cell-title">Row {r.rowNumber}</span>, reason: r.reason } }))}
            />
          ) : null}
        </div>
      </>
    );
  }

  if (batch.status === "discarded") {
    return <PageHeader title="Import discarded" lede="Nothing from this file was saved." actions={<Link href="/people/import" className="btn btn--primary">Import another file</Link>} />;
  }

  return (
    <>
      <Notice notice={notice} />
      <PageHeader
        title="Check the import"
        lede={`${batch.filename}: nothing has been saved yet. Invalid rows are skipped; everything else is saved when you confirm.`}
      />
      <div className={styles.stack}>
        <ReadoutBand
          label="Import preview"
          figures={[
            { label: "New people", value: String(summary.peopleNew) },
            { label: "Existing people matched", value: String(summary.peopleMatched) },
            { label: "New companies", value: String(summary.companiesNew) },
            { label: "Rows with errors", value: String(summary.invalid), overTarget: summary.invalid > 0 },
          ]}
        />
        <section className="card">
          <dl className={styles.readout}>
            <div><dt>Rows in the file</dt><dd className="t-meta">{summary.rows}</dd></div>
            <div><dt>Existing companies matched</dt><dd className="t-meta">{summary.companiesExisting}</dd></div>
            <div><dt>Possible duplicates, for the queue</dt><dd className="t-meta">{summary.possibleDuplicates}</dd></div>
            <div><dt>Suppressed, to be skipped</dt><dd className="t-meta">{summary.suppressed}</dd></div>
            {summary.unknownColumns.length > 0 ? <div><dt>Columns ignored</dt><dd className="t-meta">{summary.unknownColumns.join(", ")}</dd></div> : null}
          </dl>
          <div className={`btn-row ${styles.decisionBar}`}>
            <form action={commitImportAction.bind(null, batch.id)}>
              <SubmitButton>{`Import ${summary.valid} rows`}</SubmitButton>
            </form>
            <form action={discardImportAction.bind(null, batch.id)}>
              <SubmitButton variant="ghost">Discard</SubmitButton>
            </form>
          </div>
        </section>
        <div className={styles.tableHeader}>
          <h2 className="t-heading-card">Rows</h2>
          <Link href={problemsOnly ? `/people/import/${batch.id}` : `/people/import/${batch.id}?show=problems`}>{problemsOnly ? "Show all rows" : "Show only rows that need attention"}</Link>
        </div>
        <DataTable
          caption="Import rows"
          columns={[
            { key: "row", label: "Row" },
            { key: "company", label: "Company" },
            { key: "person", label: "Person" },
            { key: "result", label: "Result" },
          ]}
          rows={rows.slice(0, 500).map((r) => ({
            id: String(r.rowNumber),
            cells: {
              row: <span className="cell-title">Row {r.rowNumber}</span>,
              company: (
                <>
                  <span>{r.raw.company_name || "Missing"}</span>
                  {r.company ? <span className="cell-sub">{r.company === "existing" ? "Existing company" : r.company === "new" ? "New company" : "New, from an earlier row"}</span> : null}
                </>
              ),
              person: r.raw.person_full_name ? (
                <>
                  <span>{r.raw.person_full_name}</span>
                  <span className="cell-sub">{r.raw.person_title}</span>
                </>
              ) : (
                <span className="t-muted">Company only</span>
              ),
              result:
                r.issues.length > 0 ? (
                  <ul className={styles.issues}>
                    {r.issues.map((i) => (
                      <li key={i.column}>
                        <span className="t-meta">{i.column}</span>: {i.message}
                      </li>
                    ))}
                  </ul>
                ) : r.person ? (
                  <Chip tone={PERSON_OUTCOME[r.person].tone}>{PERSON_OUTCOME[r.person].label}</Chip>
                ) : (
                  <Chip>Company</Chip>
                ),
            },
          }))}
        />
        {rows.length > 500 ? <p className="t-caption t-muted">Showing the first 500 rows. Every row is imported.</p> : null}
      </div>
    </>
  );
}
