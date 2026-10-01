import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import styles from "@/components/compliance/Compliance.module.css";
import { AddContentForm, ContentImportForm } from "@/components/content/ContentForms";
import formStyles from "@/components/forms/Form.module.css";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { APP_BASE_PATH } from "@/config/product";
import { withWorkspace } from "@/db/client";
import { contentItems } from "@/db/schema";
import { MAX_TOPICS, topicsOf } from "@/domain/content";
import { formatDate } from "@/lib/format/labels";
import { removeContentAction, saveTopicsAction } from "@/server/content-actions";
import { allowed, pageContext } from "@/server/guards";

export const metadata: Metadata = { title: "Topics and content" };

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "settings.change")) return <PermissionDenied who="partners and data stewards" />;
  const { notice } = await searchParams;
  const topics = topicsOf(ctx.workspace.settings);
  const items = await withWorkspace(ctx.workspace.id, (tx) => tx.select().from(contentItems).orderBy(desc(contentItems.publishedOn), desc(contentItems.createdAt)));

  return (
    <>
      <Notice notice={notice} />
      <PageHeader
        title="Topics and content"
        lede="One topic list for the whole workspace, and the thought papers, newsletter issues and interview clips that drafts can suggest. A draft mentions the newest item whose topics match the person's interests, in one sentence the partner can remove."
        actions={<a href={`${APP_BASE_PATH}/api/v1/imports/template?kind=content_library`} className="btn btn--ghost" download>Download CSV template</a>}
      />
      <p className={`t-caption ${styles.back}`}><Link href="/settings">Back to Settings</Link></p>
      <div className={styles.stack}>
        <section className="card" aria-labelledby="library-heading">
          <h2 id="library-heading" className="t-heading-card">Content library</h2>
          {items.length === 0 ? (
            <EmptyState message="The library is empty. Add the partner's papers and newsletter issues below, or import them from a CSV." />
          ) : (
            <DataTable
              caption="Content library, newest first"
              columns={[{ key: "title", label: "Title" }, { key: "topics", label: "Topics" }, { key: "published", label: "Published", numeric: true }, { key: "remove", label: "Remove" }]}
              rows={items.map((i) => ({
                id: i.id,
                cells: {
                  title: (
                    <>
                      <span className="cell-title">{i.url ? <a href={i.url} rel="noreferrer" target="_blank">{i.title}</a> : i.title}</span>
                      {i.description ? <span className="cell-sub">{i.description}</span> : null}
                    </>
                  ),
                  topics: i.topics.join(", ") || "None",
                  published: i.publishedOn ? formatDate(i.publishedOn) : "Undated",
                  remove: (
                    <form action={removeContentAction.bind(null, i.id)}>
                      <SubmitButton variant="ghost" compact>Remove</SubmitButton>
                    </form>
                  ),
                },
              }))}
            />
          )}
        </section>

        <section className="card" aria-labelledby="add-heading">
          <h2 id="add-heading" className="t-heading-card">Add an item</h2>
          <AddContentForm topics={topics} />
        </section>

        <section className="card" aria-labelledby="import-heading">
          <h2 id="import-heading" className="t-heading-card">Import from a CSV</h2>
          <ContentImportForm />
        </section>

        <section className="card" aria-labelledby="topics-heading">
          <h2 id="topics-heading" className="t-heading-card">Topic vocabulary</h2>
          <form action={saveTopicsAction} className={formStyles.stack}>
            <label className={formStyles.field}>
              <span className={formStyles.label}>Topics, one per line</span>
              <textarea name="topics" rows={Math.min(14, topics.length + 2)} required defaultValue={topics.join("\n")} className={`${formStyles.input} ${formStyles.textarea}`} />
              <span className={formStyles.help}>Up to {MAX_TOPICS}. Renaming a topic does not change items or interests already tagged with the old name.</span>
            </label>
            <div className={formStyles.actions}>
              <SubmitButton>Save topics</SubmitButton>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
