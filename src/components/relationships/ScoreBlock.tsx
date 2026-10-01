/** The score block (design file 9.7): score, band, bar, and the five factors in words (BRD 11.4). */
import { BandPill } from "@/components/ui/Priority";
import type { Factors } from "@/domain/scoring";
import { formatDateIn } from "@/lib/format/labels";
import styles from "./Relationships.module.css";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function completeFactors(value: unknown): Factors | null {
  const f = value as Partial<Factors> | null;
  return f?.recency?.raw && f.frequency?.raw && f.reciprocity?.raw && f.depth?.raw && f.tenure?.raw ? (f as Factors) : null;
}

export function ScoreBlock({ firm, byUser, tz }: { firm: { score: number; band: string; factors: Factors; lastTwoWayAt: Date | null; computedAt: Date } | null; byUser: { name: string; score: number; band: string }[]; tz: string }) {
  if (!firm) return <p className="t-caption t-muted">Not scored yet. Scores are recomputed every night from the interactions on record.</p>;
  // A score stored by an older version, or imported, may lack the factor detail: show the score anyway.
  const f = completeFactors(firm.factors);
  const days = f?.recency.raw.daysSinceLastTwoWay ?? null;
  const rows: [string, string, number][] = f
    ? [
        ["Recency", days === null ? "No two-way touch on record" : `Last two-way touch: ${plural(days, "day")} ago`, f.recency.value],
        ["Frequency", `${plural(f.frequency.raw.twoWayTouches12m, "two-way touch", "two-way touches")} in 12 months`, f.frequency.value],
        ["Reciprocity", `They wrote in ${f.reciprocity.raw.inboundThreads12m} of ${plural(f.reciprocity.raw.threads12m, "email thread")}`, f.reciprocity.value],
        ["Depth", `${plural(f.depth.raw.meetings, "meeting")}, ${plural(f.depth.raw.calls, "call")}, ${plural(f.depth.raw.emailThreads, "email thread")}, ${plural(f.depth.raw.linkedinUnits, "other touch", "other touches")}`, f.depth.value],
        ["Tenure", f.tenure.raw.yearsSinceFirstTwoWay === null ? "No two-way touch yet" : `${f.tenure.raw.yearsSinceFirstTwoWay} years since the first two-way touch`, f.tenure.value],
      ]
    : [];
  return (
    <div className={styles.score}>
      <div className={styles.figure}>
        <strong>{firm.score}</strong>
        <span className="t-meta t-muted">/ 100</span>
        <BandPill band={firm.band} />
      </div>
      <div className={styles.track} role="img" aria-label={`Score ${firm.score} out of 100`}>
        <div className={styles.bar} style={{ width: `${firm.score}%` }} />
      </div>
      {f ? null : <p className="t-caption t-muted">The factors behind this score are recomputed tonight.</p>}
      <dl className={styles.rows}>
        {rows.map(([label, words, value]) => (
          <div key={label}>
            <dt>{label}<span>{words}</span></dt>
            <dd>{value.toFixed(2)}</dd>
          </div>
        ))}
      </dl>
      {byUser.length ? <p className="t-caption t-muted">By team member: {byUser.map((u) => `${u.name} ${u.score} (${u.band})`).join(", ")}.</p> : null}
      <p className="t-caption t-muted">Computed {formatDateIn(firm.computedAt, tz)} from the interactions on record.</p>
    </div>
  );
}
