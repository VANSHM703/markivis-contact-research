import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import styles from "@/components/compliance/Compliance.module.css";
import formStyles from "@/components/forms/Form.module.css";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Chip } from "@/components/ui/Chip";
import { DataTable } from "@/components/ui/DataTable";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { withWorkspace } from "@/db/client";
import { importBatches } from "@/db/schema";
import { commitContentImportAction, discardContentImportAction, type StoredContentBatch } from "@/server/content-actions";
import { allowed, pageContext, requireUuid } from "@/server/guards";

export const metadata: Metadata = { title: "Content import" };

export default async function ContentImportPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<{ notice?: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "settings.change")) return <PermissionDenied who="partners and data stewards" />;
  const { batchId } = await params;
  requireUuid(batchId);
  const { notice } = await searchParams;
  const [batch] = await withWorkspace(ctx.workspace.id, (tx) => tx.select().from(importBatches).where(and(eq(importBatches.id, batchId), eq(importBatches.kind, "content_library"))).limit(1));
  if (!batch) notFound();
  const stored = batch.rows as StoredContentBatch;
  const valid = stored.rows.filter((r) => r.issues.length === 0).length;
  const report = batch.report as { created: number; rejected: { rowNumber: number; reason: string }[] } | null;

  return (
    <>
      <Notice notice={notice} />
      <PageHeader title={batch.status === "committed" ? "Content imported" : "Check the import"} lede={batch.status === "committed" && report ? `${report.created} items added, ${report.rejected.length} rows skipped.` : `${batch.filename}: ${stored.rows.length} rows, ${valid} ready to add, ${stored.rows.length - valid} with problems that will be skipped.`} />
      <p className={`t-caption ${styles.back}`}><Link href="/settings/content">Back to Topics and content</Link></p>
      <div className={styles.stack}>
        {stored.unknownColumns.length ? <p className="t-caption t-muted">Ignored columns: {stored.unknownColumns.join(", ")}.</p> : null}
        <DataTable
          caption="Rows in the file"
          columns={[{ key: "row", label: "Row", numeric: true }, { key: "title", label: "Title" }, { key: "topics", label: "Topics" }, { key: "check", label: "Check" }]}
          rows={stored.rows.map((r) => ({
            id: String(r.rowNumber),
            cells: {
              row: r.rowNumber,
              title: r.item.title || "No title",
              topics: r.item.topics.join(", ") || "None",
              check: r.issues.length ? <Chip tone="blocked">{r.issues.map((i) => i.message).join(" ")}</Chip> : "Ready",
            },
          }))}
        />
        {batch.status === "previewed" ? (
          <div className={formStyles.actions}>
            <form action={commitContentImportAction.bind(null, batch.id)}>
              <SubmitButton>{`Add ${valid} ${valid === 1 ? "item" : "items"}`}</SubmitButton>
            </form>
            <form action={discardContentImportAction.bind(null, batch.id)}>
              <SubmitButton variant="ghost">Discard</SubmitButton>
            </form>
          </div>
        ) : null}
      </div>
    </>
  );
}
