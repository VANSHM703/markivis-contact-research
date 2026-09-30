import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Chip } from "@/components/ui/Chip";
import { Notice } from "@/components/ui/Notice";
import { getRequestContext } from "@/lib/context";
import { CLIENT_STATUS_LABELS, formatDate, OWNERSHIP_LABELS, SEAT_TYPE_LABELS } from "@/lib/format/labels";
import { can } from "@/lib/permissions";
import { getCompany } from "@/server/records";
import { UUID_RE } from "@/server/guards";
import styles from "../../record.module.css";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await getRequestContext();
  const { id } = await params;
  if (!ctx || !UUID_RE.test(id)) return { title: "Company" };
  return { title: (await getCompany(ctx.workspace.id, id))?.company.name ?? "Company" };
}

const OFF_LIMITS_REASON: Record<string, string> = { current_client: "Current client", recent_placement: "Recent placement", contractual: "Contractual" };

export default async function CompanyPage({ params, searchParams }: Props) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  const { id } = await params;
  const { notice } = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const record = await getCompany(ctx.workspace.id, id);
  if (!record) notFound();
  const { company, seats, offLimits } = record;
  const editor = can(ctx.role, "records.edit");
  const packOn = ctx.workspace.packs.exec_search;
  const leadership = seats.filter((s) => s.seatType !== "board");
  const board = seats.filter((s) => s.seatType === "board");
  const today = new Date().toISOString().slice(0, 10);
  const activeRules = offLimits.filter((r) => r.startsOn <= today && (!r.endsOn || r.endsOn >= today));

  return (
    <>
      <Notice notice={notice} />
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className="t-display-3">{company.name}</h1>
          <p className="t-lede">{company.isSponsor ? "PE sponsor" : company.industry}</p>
          <div className={styles.facts}>
            <Chip>{OWNERSHIP_LABELS[company.ownership] ?? company.ownership}</Chip>
            {company.targetTier ? <Chip>{`Tier ${company.targetTier}`}</Chip> : null}
            <Chip>{CLIENT_STATUS_LABELS[company.clientStatus] ?? company.clientStatus}</Chip>
            {packOn && activeRules.length > 0 ? <Chip tone="blocked">Off-limits</Chip> : null}
          </div>
        </div>
        {editor ? (
          <div className={`${styles.headerActions} btn-row`}>
            <Link href={`/companies/${company.id}/edit`} className="btn btn--ghost">Edit details</Link>
            <Link href={`/people/new?company=${company.id}`} className="btn btn--ghost">Add person</Link>
          </div>
        ) : null}
      </div>
      <div className={styles.columns}>
        <div className={styles.stack}>
          {[{ title: "Leadership", rows: leadership }, { title: "Board", rows: board }].map((group) => (
            <section key={group.title} className="card" aria-label={group.title}>
              <h2 className="t-heading-card">{group.title}</h2>
              {group.rows.length === 0 ? (
                <p className="t-caption t-muted">No one mapped.</p>
              ) : (
                <ul className={styles.seats}>
                  {group.rows.map((s) => (
                    <li key={s.roleId}>
                      <span>
                        <Link href={`/people/${s.personId}`}>{s.fullName}</Link>, {s.title}
                        {s.status === "announced" ? <span className="t-caption t-muted"> (announced)</span> : null}
                      </span>
                      <span className="t-meta t-muted">
                        {SEAT_TYPE_LABELS[s.seatType]}
                        {s.effectiveOn ? ` · since ${formatDate(s.effectiveOn)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
        <section className="card" aria-labelledby="company-facts">
          <h2 id="company-facts" className="t-heading-card">Details</h2>
          <dl className={styles.readout}>
            <div><dt>Domain</dt><dd>{company.domain ?? "Not recorded"}</dd></div>
            <div><dt>Headquarters</dt><dd>{[company.hqRegion, company.hqCountry].filter(Boolean).join(", ") || "Not recorded"}</dd></div>
            <div><dt>Employees</dt><dd className="t-meta">{company.employeeCount?.toLocaleString("en-US") ?? "Unknown"}</dd></div>
            {company.secCik ? <div><dt>SEC CIK</dt><dd className="t-meta">{company.secCik}</dd></div> : null}
            {company.aliases.length ? <div><dt>Also known as</dt><dd>{company.aliases.join(", ")}</dd></div> : null}
          </dl>
          {packOn && offLimits.length > 0 ? (
            <>
              <h3 className={styles.subheading}>Off-limits rules</h3>
              <ul className={styles.seats}>
                {offLimits.map((r) => (
                  <li key={r.id}>
                    <span>{r.scope === "company" ? "Whole company" : r.scope === "function" ? `${r.function} function` : "By seniority"}, {OFF_LIMITS_REASON[r.reason]}</span>
                    <span className="t-meta t-muted">
                      {formatDate(r.startsOn)} to {r.endsOn ? formatDate(r.endsOn) : "no end date"}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}
