import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar } from "@/components/ui/FilterBar";
import { PageHeader } from "@/components/ui/PageHeader";
import { OWNERSHIP_OPTIONS } from "@/server/forms";
import { coverage, SEATS, seatTitle, type CoverageFilters } from "@/server/relationships";
import { pageContext } from "@/server/guards";
import styles from "@/components/relationships/Relationships.module.css";

export const metadata: Metadata = { title: "Coverage" };

const BANDS = ["strong", "warm", "cooling", "cold", "none"] as const;
const BAND_WORDS: Record<string, string> = { strong: "Strong", warm: "Warm", cooling: "Cooling", cold: "Cold", none: "None or not scored" };
const surname = (name: string) => name.split(" ").slice(-1)[0] ?? name;

/** Seat coverage map (BRD 11.8, design file 9.11). */
export default async function CoveragePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageContext();
  const params = await searchParams;
  const tier = Number(params.tier);
  const filters: CoverageFilters = { tier: [1, 2, 3].includes(tier) ? (tier as 1 | 2 | 3) : undefined, industry: params.sector || undefined, ownership: params.ownership || undefined };
  const { rows, industries } = await coverage(ctx, filters);
  const mapped = rows.reduce((n, r) => n + SEATS.filter((s) => r.cells[s].length > 0).length, 0);

  return (
    <>
      <PageHeader title="Coverage" lede={`${mapped} of ${rows.length * SEATS.length} seats mapped across ${rows.length} target companies, tinted by the firm's relationship with each person.`} />
      <FilterBar
        path="/coverage"
        searchLabel={null}
        values={{ tier: filters.tier ? String(filters.tier) : undefined, sector: filters.industry, ownership: filters.ownership }}
        selects={[
          { name: "tier", label: "Target tier", options: [1, 2, 3].map((t) => ({ value: String(t), label: `Tier ${t}` })) },
          { name: "sector", label: "Sector", options: industries.map((i) => ({ value: i, label: i })) },
          { name: "ownership", label: "Ownership", options: OWNERSHIP_OPTIONS.filter((o) => o.value !== "unknown") },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState message="Add target companies to see coverage." actions={<Link href="/people/import" className="btn btn--primary">Import target list</Link>} />
      ) : (
        <>
          <p className={styles.legend} aria-label="Legend">
            {BANDS.map((b) => (
              <span key={b}><span className={`${styles.swatch} ${styles[b]}`} aria-hidden="true" />{BAND_WORDS[b]}</span>
            ))}
          </p>
          <div className={styles.gridWrap}>
            <table className={styles.grid}>
              <caption className="visually-hidden">Target companies against leadership and board seats</caption>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  {SEATS.map((s) => <th key={s} scope="col">{s}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">
                      <Link href={`/companies/${r.id}`}>{r.name}</Link>
                      <span className="t-meta t-muted"> T{r.tier}</span>
                    </th>
                    {SEATS.map((seat) => {
                      const people = r.cells[seat];
                      return (
                        <td key={seat}>
                          {people.length === 0 ? (
                            <Link className={`${styles.cell} ${styles.empty}`} href={`/people/new?company=${r.id}&title=${encodeURIComponent(seatTitle(seat))}`}>
                              No one mapped<span className="visually-hidden">: {seat} at {r.name}, add a person</span>
                            </Link>
                          ) : (
                            people.slice(0, 2).map((p) => (
                              <Link key={p.personId} className={`${styles.cell} ${styles[p.band as (typeof BANDS)[number]] ?? styles.none}`} href={`/people/${p.personId}`}>
                                {surname(p.name)}
                                <span className="visually-hidden">, {seat} at {r.name}, {BAND_WORDS[p.band] ?? "not scored"}</span>
                              </Link>
                            ))
                          )}
                          {people.length > 2 ? <span className="t-caption t-muted">+{people.length - 2} more</span> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
