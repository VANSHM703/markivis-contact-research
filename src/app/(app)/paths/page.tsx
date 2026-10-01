import type { Metadata } from "next";
import Link from "next/link";
import { APP_BASE_PATH } from "@/config/product";
import { PathList } from "@/components/relationships/PathList";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { withWorkspace } from "@/db/client";
import { searchPeople } from "@/domain/matching";
import { can } from "@/lib/permissions";
import { pathsFor } from "@/server/relationships";
import { pageContext, UUID_RE } from "@/server/guards";
import formStyles from "@/components/forms/Form.module.css";
import styles from "@/components/relationships/Relationships.module.css";

export const metadata: Metadata = { title: "Paths" };

/** Warm path finder (BRD 11.7, 16.2): search a person, see who can introduce you. */
export default async function PathsPage({ searchParams }: { searchParams: Promise<{ q?: string; person?: string; notice?: string }> }) {
  const ctx = await pageContext();
  const { q, person, notice } = await searchParams;
  const query = q?.trim().slice(0, 100) ?? "";
  const matches = query ? await withWorkspace(ctx.workspace.id, (tx) => searchPeople(tx, query)) : [];
  const result = person && UUID_RE.test(person) ? await pathsFor(ctx, person) : null;
  const off = ctx.workspace.flags["rel.paths"] === false;

  return (
    <>
      <Notice notice={notice} />
      <PageHeader title="Paths" lede="Who can introduce you: your direct relationship, or a warm contact who sat on a board or worked with the person." />
      {off ? <EmptyState message="The warm path finder is switched off for this workspace." /> : null}
      <form method="get" action={`${APP_BASE_PATH}/paths`} className={`card ${formStyles.stack}`} role="search" aria-label="Find a person">
        <label className={formStyles.field}>
          <span className={formStyles.label}>Person</span>
          <input type="search" name="q" defaultValue={query} placeholder="Name of the person you want to reach" className={formStyles.input} autoComplete="off" />
        </label>
        <div className={formStyles.actions}>
          <button type="submit" className="btn btn--ghost">Find paths</button>
        </div>
      </form>
      {query && !result ? (
        matches.length ? (
          <ul className={`card ${styles.matches}`} aria-label="Matching people">
            {matches.map((m) => (
              <li key={m.id} className={styles.match}>
                <Link href={`/paths?person=${m.id}`}>{m.fullName}</Link>
                {m.title || m.companyName ? <span className="t-caption t-muted">{[m.title, m.companyName].filter(Boolean).join(", ")}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState message={`No one called "${query}" in this workspace.`} />
        )
      ) : null}
      {result ? (
        <section className="card" aria-labelledby="paths-heading">
          <h2 id="paths-heading" className="t-heading-card">
            Paths to <Link href={`/people/${result.target.id}`}>{result.target.name}</Link>
          </h2>
          {result.target.title ? <p className="t-caption t-muted">{result.target.title}{result.target.company ? `, ${result.target.company}` : ""}</p> : null}
          <PathList paths={result.paths} targetId={result.target.id} targetName={result.target.name} canDraft={can(ctx.role, "messages.send")} empty="No warm path yet: no strong or warm relationship with them or with anyone connected to them." />
        </section>
      ) : null}
      {!query && !result && !off ? <EmptyState message="Search for a person to see who can introduce you." /> : null}
    </>
  );
}
