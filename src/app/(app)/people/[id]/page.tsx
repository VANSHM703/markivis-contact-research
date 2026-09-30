import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Chip } from "@/components/ui/Chip";
import { getRequestContext } from "@/lib/context";
import { CONTACT_TYPE_LABELS, formatDate, SEAT_TYPE_LABELS } from "@/lib/format/labels";
import { getPerson } from "@/server/records";
import styles from "../../record.module.css";

export const metadata: Metadata = { title: "Person" };

const UUID_RE = /^[0-9a-f-]{36}$/i;

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const record = await getPerson(ctx.workspace.id, id);
  if (!record) notFound();
  const { person, roles } = record;
  const primary = roles.find((r) => r.isPrimary);

  return (
    <>
      <div className={styles.header}>
        <h1 className="t-display-3">{person.fullName}</h1>
        <p className="t-lede">{primary ? `${primary.title}, ${primary.companyName}` : "No current role"}</p>
        <div>
          {person.contactTypes.map((t) => (
            <Chip key={t}>{CONTACT_TYPE_LABELS[t] ?? t}</Chip>
          ))}
          {person.status === "do_not_contact" ? <Chip tone="blocked">Do not contact</Chip> : null}
        </div>
      </div>
      <section className="card" aria-labelledby="roles-heading">
        <h2 id="roles-heading" className="t-heading-card">Roles</h2>
        <ol className={styles.timeline}>
          {roles.map((r) => (
            <li key={r.id} className={r.status === "ended" ? styles.ended : undefined}>
              <p className={styles.itemTitle}>
                {r.title}, <Link href={`/companies/${r.companyId}`}>{r.companyName}</Link>
              </p>
              <p className="t-meta t-muted">
                {SEAT_TYPE_LABELS[r.seatType]} · {formatDate(r.effectiveOn)} to {r.endedOn ? formatDate(r.endedOn) : "present"}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
