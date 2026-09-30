import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { withWorkspace } from "@/db/client";
import { searchPeople } from "@/domain/matching";
import { formatDate } from "@/lib/format/labels";
import { mergeAction } from "@/server/record-actions";
import { getPerson } from "@/server/records";
import { allowed, pageContext, requireUuid, UUID_RE } from "@/server/guards";
import styles from "../../../record.module.css";

export const metadata: Metadata = { title: "Merge records" };

export default async function MergePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; other?: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "persons.merge")) return <PermissionDenied who="partners and validators" />;
  const { id } = await params;
  requireUuid(id);
  const { q, other } = await searchParams;
  const survivor = await getPerson(ctx.workspace.id, id);
  if (!survivor || survivor.mergedInto) notFound();

  const candidate = other && UUID_RE.test(other) && other !== id ? await getPerson(ctx.workspace.id, other) : null;
  const results = q?.trim() && !candidate ? (await withWorkspace(ctx.workspace.id, (tx) => searchPeople(tx, q, 15))).filter((p) => p.id !== id) : [];
  const primary = (r: NonNullable<typeof survivor>) => r.roles.find((x) => x.isPrimary);

  return (
    <>
      <PageHeader title={`Merge into ${survivor.person.fullName}`} lede="The other record's roles, interactions and history move here. You can reverse a merge for 90 days." />
      {candidate && !candidate.mergedInto ? (
        <section className={`card ${styles.stack}`} aria-labelledby="confirm-heading">
          <h2 id="confirm-heading" className="t-heading-card">Check before you merge</h2>
          <div className={styles.columns}>
            {[{ label: "Keep", r: survivor }, { label: "Merge and hide", r: candidate }].map(({ label, r }) => (
              <dl key={r.person.id} className={styles.readout}>
                <div><dt>{label}</dt><dd><strong>{r.person.fullName}</strong></dd></div>
                <div><dt>Primary role</dt><dd>{primary(r) ? `${primary(r)!.title}, ${primary(r)!.companyName}` : "None"}</dd></div>
                <div><dt>Location</dt><dd>{[r.person.city, r.person.country].filter(Boolean).join(", ") || "Not recorded"}</dd></div>
                <div><dt>LinkedIn</dt><dd>{r.person.linkedinUrl ? "Recorded" : "Not recorded"}</dd></div>
                <div><dt>Added</dt><dd className="t-meta">{formatDate(r.person.createdAt)}</dd></div>
                <div><dt>Roles</dt><dd className="t-meta">{r.roles.length}</dd></div>
              </dl>
            ))}
          </div>
          <form action={mergeAction.bind(null, survivor.person.id, candidate.person.id)} className="btn-row">
            <SubmitButton>{`Merge ${candidate.person.fullName} into ${survivor.person.fullName}`}</SubmitButton>
            <Link href={`/people/${survivor.person.id}/merge`} className="btn btn--ghost">Choose someone else</Link>
          </form>
        </section>
      ) : (
        <section className="card" aria-labelledby="find-heading">
          <h2 id="find-heading" className="t-heading-card">Find the duplicate record</h2>
          <form method="get" className={styles.inlineGrid}>
            <label className={styles.grow}>
              <span className={styles.miniLabel}>Name</span>
              <input type="search" name="q" defaultValue={q ?? survivor.person.fullName} className={styles.miniInput} />
            </label>
            <button type="submit" className="btn btn--ghost">Search</button>
          </form>
          {q ? (
            results.length === 0 ? (
              <p className="t-caption t-muted">No other records match that name.</p>
            ) : (
              <ul className={styles.seats}>
                {results.map((p) => (
                  <li key={p.id}>
                    <span>
                      <strong>{p.fullName}</strong>
                      {p.title ? `, ${p.title}${p.companyName ? `, ${p.companyName}` : ""}` : ""}
                    </span>
                    <Link href={`/people/${survivor.person.id}/merge?other=${p.id}`} className="btn btn--ghost btn--compact">
                      Compare <span className="arrow" aria-hidden="true">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>
      )}
    </>
  );
}
