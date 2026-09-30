import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { withWorkspace } from "@/db/client";
import { searchCompanies, searchPeople } from "@/domain/matching";
import { pageContext } from "@/server/guards";
import styles from "../record.module.css";

export const metadata: Metadata = { title: "Search" };

/** Global search results for people and companies (BRD 16.1). */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await pageContext();
  const q = (await searchParams).q?.trim().slice(0, 100) ?? "";
  const [people, companies] = q
    ? await withWorkspace(ctx.workspace.id, async (tx) => [await searchPeople(tx, q, 20), await searchCompanies(tx, q, 20)] as const)
    : [[], []];

  return (
    <>
      <PageHeader title={q ? `Results for "${q}"` : "Search"} lede={q ? `${people.length} people and ${companies.length} companies.` : "Search people and companies from the top bar, or press /."} />
      {q && people.length + companies.length === 0 ? <EmptyState message="Nothing matches that search. Check the spelling, or search by company." /> : null}
      <div className={styles.columns}>
        {people.length > 0 ? (
          <section className="card" aria-labelledby="people-results">
            <h2 id="people-results" className="t-heading-card">People</h2>
            <ul className={styles.seats}>
              {people.map((p) => (
                <li key={p.id}>
                  <Link href={`/people/${p.id}`}>{p.fullName}</Link>
                  <span className="t-caption t-muted">{p.title ? `${p.title}${p.companyName ? `, ${p.companyName}` : ""}` : "No current role"}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {companies.length > 0 ? (
          <section className="card" aria-labelledby="company-results">
            <h2 id="company-results" className="t-heading-card">Companies</h2>
            <ul className={styles.seats}>
              {companies.map((c) => (
                <li key={c.id}>
                  <Link href={`/companies/${c.id}`}>{c.name}</Link>
                  <span className="t-caption t-muted">{c.industry ?? c.domain ?? ""}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
