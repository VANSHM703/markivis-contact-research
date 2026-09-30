/** Upload, preview and result pages for the pack imports (BRD 16.4), shared by both kinds. */
import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { ImportForm } from "@/components/records/ImportForm";
import { Chip } from "@/components/ui/Chip";
import { DataTable } from "@/components/ui/DataTable";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReadoutBand } from "@/components/ui/ReadoutBand";
import { APP_BASE_PATH } from "@/config/product";
import { withWorkspace } from "@/db/client";
import { importBatches } from "@/db/schema";
import { IMPORT_PATH, PACK_COLUMNS, type PackImportKind, type PackImportReport, type PackOutcome } from "@/domain/imports/pack";
import { commitPackImportAction, discardPackImportAction, uploadPackImportAction, type StoredPackBatch } from "@/server/pack-actions";
import styles from "@/app/(app)/record.module.css";

const TITLES: Record<PackImportKind, { title: string; lede: string; file: string; help: string; source: string; done: { href: string; label: string } }> = {
  placements: {
    title: "Import placements",
    lede: "Executives your firm has placed. Each person is matched to an existing record, or added with the placed role. Placed executives are priority 1 on every move.",
    file: "Placements",
    help: "One row per placement.",
    source: "Where did these placements come from?",
    done: { href: "/people?flag=placed", label: "Open placed people" },
  },
  off_limits: {
    title: "Import off-limits rules",
    lede: "Rules per company, by scope, reason and dates. Each company must already be on the target list.",
    file: "Off-limits rules",
    help: "One row per rule.",
    source: "Where did these rules come from?",
    done: { href: "/settings/off-limits", label: "Open off-limits rules" },
  },
};

const OUTCOME: Record<PackOutcome, { label: string; tone?: "blocked" }> = {
  new_person: { label: "New person, with the placement" },
  matched: { label: "Matches an existing person" },
  possible_duplicate: { label: "Possible duplicate: goes to the queue" },
  already_recorded: { label: "Already recorded: will be skipped" },
  suppressed: { label: "Suppressed: will be skipped", tone: "blocked" },
  rule: { label: "New rule" },
};

export function PackImportStart({ kind, notice }: { kind: PackImportKind; notice?: string }) {
  const t = TITLES[kind];
  return (
    <>
      <Notice notice={notice} />
      <PageHeader
        title={t.title}
        lede={t.lede}
        actions={
          <a href={`${APP_BASE_PATH}/api/v1/imports/template?kind=${kind}`} className="btn btn--ghost" download>
            Download template
          </a>
        }
      />
      <div className={styles.columns}>
        <ImportForm action={uploadPackImportAction.bind(null, kind)} fileLabel={t.file} fileHelp={t.help} sourceTitle={t.source} />
        <section className="card" aria-labelledby="columns-heading">
          <h2 id="columns-heading" className="t-heading-card">Columns</h2>
          <p className="t-caption t-muted">Column names are not case sensitive, and other columns are ignored.</p>
          <dl className={styles.columnList}>
            {PACK_COLUMNS[kind].map((c) => (
              <div key={c.key}>
                <dt className="t-meta">
                  {c.key}
                  {c.required === "always" ? <span className={styles.required}> required</span> : null}
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

export async function PackImportBatch({ kind, workspaceId, batchId, notice }: { kind: PackImportKind; workspaceId: string; batchId: string; notice?: string }) {
  const [batch] = await withWorkspace(workspaceId, (tx) => tx.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1));
  if (!batch || batch.kind !== kind) notFound();
  const t = TITLES[kind];
  const stored = batch.rows as StoredPackBatch;
  const { summary } = stored;
  const report = batch.report as PackImportReport | null;

  if (batch.status === "committed" && report) {
    return (
      <>
        <Notice notice={notice} />
        <PageHeader title="Import complete" lede={`${batch.filename}: ${summary.rows} rows processed.`} actions={<Link href={t.done.href} className="btn btn--primary">{t.done.label}</Link>} />
        <div className={styles.stack}>
          <ReadoutBand
            label="Import result"
            figures={
              kind === "placements"
                ? [
                    { label: "Placements recorded", value: String(report.placementsCreated) },
                    { label: "People created", value: String(report.peopleCreated) },
                    { label: "People matched", value: String(report.peopleMatched) },
                    { label: "Rows rejected", value: String(report.rejected.length) },
                  ]
                : [
                    { label: "Rules created", value: String(report.rulesCreated) },
                    { label: "Rows skipped", value: String(report.skipped) },
                    { label: "Rows rejected", value: String(report.rejected.length) },
                  ]
            }
          />
          {report.possibleDuplicates > 0 ? (
            <p className={styles.warnLine}>
              {report.possibleDuplicates} possible duplicates are waiting for a validator. <Link href="/queue?tab=conflicts">Open conflicts and duplicates</Link>
            </p>
          ) : null}
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
    return <PageHeader title="Import discarded" lede="Nothing from this file was saved." actions={<Link href={IMPORT_PATH[kind]} className="btn btn--primary">Import another file</Link>} />;
  }

  return (
    <>
      <Notice notice={notice} />
      <PageHeader title="Check the import" lede={`${batch.filename}: nothing has been saved yet. Invalid rows are skipped; everything else is saved when you confirm.`} />
      <div className={styles.stack}>
        <ReadoutBand
          label="Import preview"
          figures={[
            { label: kind === "placements" ? "New people" : "New rules", value: String(summary.created) },
            ...(kind === "placements" ? [{ label: "Existing people matched", value: String(summary.matched) }, { label: "Skipped", value: String(summary.skipped) }] : []),
            { label: "Rows with errors", value: String(summary.invalid), overTarget: summary.invalid > 0 },
          ]}
        />
        <section className="card">
          <dl className={styles.readout}>
            <div><dt>Rows in the file</dt><dd className="t-meta">{summary.rows}</dd></div>
            {kind === "placements" ? <div><dt>Possible duplicates, for the queue</dt><dd className="t-meta">{summary.possibleDuplicates}</dd></div> : null}
            {summary.unknownColumns.length > 0 ? <div><dt>Columns ignored</dt><dd className="t-meta">{summary.unknownColumns.join(", ")}</dd></div> : null}
          </dl>
          <div className={`btn-row ${styles.decisionBar}`}>
            <form action={commitPackImportAction.bind(null, kind, batch.id)}>
              <SubmitButton>{`Import ${summary.valid} rows`}</SubmitButton>
            </form>
            <form action={discardPackImportAction.bind(null, kind, batch.id)}>
              <SubmitButton variant="ghost">Discard</SubmitButton>
            </form>
          </div>
        </section>
        <DataTable
          caption="Import rows"
          columns={[
            { key: "row", label: "Row" },
            { key: "company", label: "Company" },
            { key: "detail", label: kind === "placements" ? "Person and role" : "Rule" },
            { key: "result", label: "Result" },
          ]}
          rows={stored.rows.slice(0, 500).map((r) => ({
            id: String(r.rowNumber),
            cells: {
              row: <span className="cell-title">Row {r.rowNumber}</span>,
              company: (
                <>
                  <span>{r.raw.company_name || "Missing"}</span>
                  {r.company ? <span className="cell-sub">{r.company === "existing" ? "Existing company" : "New company"}</span> : null}
                </>
              ),
              detail:
                kind === "placements" ? (
                  <>
                    <span>{r.raw.person_full_name || "Missing"}</span>
                    <span className="cell-sub">{[r.raw.role_title, r.raw.placed_on].filter(Boolean).join(", ")}</span>
                  </>
                ) : (
                  <>
                    <span>{r.raw.scope || "Missing"}{r.raw.function ? `: ${r.raw.function}` : r.raw.min_seniority ? `: ${r.raw.min_seniority} and above` : ""}</span>
                    <span className="cell-sub">{[r.raw.reason, r.raw.starts_on, r.raw.ends_on ? `to ${r.raw.ends_on}` : "no end date"].filter(Boolean).join(", ")}</span>
                  </>
                ),
              result:
                r.issues.length > 0 ? (
                  <ul className={styles.issues}>
                    {r.issues.map((i) => (
                      <li key={`${i.column}${i.message}`}>
                        <span className="t-meta">{i.column}</span>: {i.message}
                      </li>
                    ))}
                  </ul>
                ) : r.outcome ? (
                  <Chip tone={OUTCOME[r.outcome].tone}>{OUTCOME[r.outcome].label}</Chip>
                ) : null,
            },
          }))}
        />
        {stored.rows.length > 500 ? <p className="t-caption t-muted">Showing the first 500 rows. Every row is imported.</p> : null}
      </div>
    </>
  );
}
