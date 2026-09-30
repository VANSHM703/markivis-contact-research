import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Chip } from "@/components/ui/Chip";
import { getRequestContext } from "@/lib/context";
import { CLIENT_STATUS_LABELS, OWNERSHIP_LABELS, SEAT_TYPE_LABELS } from "@/lib/format/labels";
import { getCompany } from "@/server/records";
import styles from "../../record.module.css";

export const metadata: Metadata = { title: "Company" };

const UUID_RE = /^[0-9a-f-]{36}$/i;

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const record = await getCompany(ctx.workspace.id, id);
  if (!record) notFound();
  const { company, seats } = record;

  return (
    <>
      <div className={styles.header}>
        <h1 className="t-display-3">{company.name}</h1>
        <p className="t-lede">{company.isSponsor ? "PE sponsor" : company.industry}</p>
        <div className={styles.facts}>
          <Chip>{OWNERSHIP_LABELS[company.ownership] ?? company.ownership}</Chip>
          {company.targetTier ? <Chip>{`Tier ${company.targetTier}`}</Chip> : null}
          <Chip>{CLIENT_STATUS_LABELS[company.clientStatus] ?? company.clientStatus}</Chip>
        </div>
      </div>
      <section className="card" aria-labelledby="seats-heading">
        <h2 id="seats-heading" className="t-heading-card">Leadership and board</h2>
        {seats.length === 0 ? (
          <p className="t-caption t-muted">No one mapped.</p>
        ) : (
          <ul className={styles.seats}>
            {seats.map((s) => (
              <li key={s.roleId}>
                <span>
                  <Link href={`/people/${s.personId}`}>{s.fullName}</Link>, {s.title}
                </span>
                <span className="t-meta t-muted">{SEAT_TYPE_LABELS[s.seatType]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
