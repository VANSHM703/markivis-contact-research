import type { Metadata } from "next";
import Link from "next/link";
import { APP_BASE_PATH } from "@/config/product";
import formStyles from "@/components/forms/Form.module.css";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { Tabs } from "@/components/ui/Tabs";
import type { ScoringSettings } from "@/domain/scoring";
import { formatDate } from "@/lib/format/labels";
import { saveCalibrationAction, saveScoringAction } from "@/server/relationship-actions";
import { calibration, CALIBRATION_SIZE } from "@/server/relationships";
import { allowed, pageContext } from "@/server/guards";
import styles from "@/components/relationships/Relationships.module.css";
import settingsStyles from "@/components/settings/Settings.module.css";

export const metadata: Metadata = { title: "Scoring" };

const WEIGHTS = [
  ["recency", "Recency", "How recently you last had a two-way exchange"],
  ["frequency", "Frequency", "Two-way touches in the last 12 months"],
  ["reciprocity", "Reciprocity", "Share of email threads where they wrote back"],
  ["depth", "Depth", "Meetings, calls, threads and other touches"],
  ["tenure", "Tenure", "Years since the first two-way touch"],
] as const;
const BANDS = [["strong", "Strong from"], ["warm", "Warm from"], ["cooling", "Cooling from"], ["cold", "Cold from"]] as const;

function describe(r: number | null): string {
  if (r === null) return "Not enough people ranked yet.";
  const strength = Math.abs(r) >= 0.7 ? "strong" : Math.abs(r) >= 0.4 ? "moderate" : "weak";
  return `${r.toFixed(2)}: a ${strength} ${r >= 0 ? "agreement" : "disagreement"} between your ranking and the scores.`;
}

/** Scoring weights, bands and calibration (BRD 11.4, 16.2). Weights are the partner's to change. */
export default async function ScoringPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "settings.change")) return <PermissionDenied who="partners and data stewards" />;
  const params = await searchParams;
  const tab = params.tab === "calibration" ? "calibration" : "weights";
  const partner = ctx.role === "partner";
  const candidate = WEIGHTS.every(([k]) => params[`w_${k}`] !== undefined)
    ? (Object.fromEntries(WEIGHTS.map(([k]) => [k, Number(params[`w_${k}`])])) as ScoringSettings["weights"])
    : undefined;
  const cal = await calibration(ctx, candidate);
  const w = cal.settings.weights;

  return (
    <>
      <Notice notice={params.notice} />
      <PageHeader title="Scoring" lede="How relationship strength is scored from interactions, and how well it matches what you know." />
      <p className="t-caption"><Link href="/settings">Back to Settings</Link></p>
      <Tabs label="Scoring sections" current={tab} tabs={[{ key: "weights", label: "Weights and bands", href: "/settings/scoring" }, { key: "calibration", label: "Calibration", href: "/settings/scoring?tab=calibration" }]} />
      {tab === "weights" ? (
        <form action={saveScoringAction} className={`card ${formStyles.stack}`}>
          <p className="t-caption t-muted">score = 100 × (weights × factors), each factor between 0 and 1. The five weights add up to 1.00. {partner ? "Saving recomputes every score." : "Only the partner can change these."}</p>
          <fieldset className={formStyles.fieldset}>
            <legend className="t-heading-card">Weights</legend>
            <div className={styles.weights}>
              {WEIGHTS.map(([key, label, help]) => (
                <label key={key} className={formStyles.field}>
                  <span className={formStyles.label}>{label}</span>
                  <input type="number" name={`w_${key}`} step="0.05" min="0" max="1" required defaultValue={w[key]} className={formStyles.input} disabled={!partner} />
                  <span className={formStyles.help}>{help}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className={formStyles.fieldset}>
            <legend className="t-heading-card">Bands</legend>
            <div className={styles.weights}>
              {BANDS.map(([key, label]) => (
                <label key={key} className={formStyles.field}>
                  <span className={formStyles.label}>{label}</span>
                  <input type="number" name={`b_${key}`} step="1" min="1" max="100" required defaultValue={cal.settings.bands[key]} className={formStyles.input} disabled={!partner} />
                </label>
              ))}
            </div>
          </fieldset>
          {partner ? (
            <div className={formStyles.actions}>
              <SubmitButton>Save and recompute</SubmitButton>
            </div>
          ) : null}
        </form>
      ) : partner ? (
        <div className={settingsStyles.stack}>
          <section className="card" aria-labelledby="rank-heading">
            <h2 id="rank-heading" className="t-heading-card">Rank the people you know best</h2>
            <p className="t-caption t-muted">
              These are the {cal.people.length} people you have most contact with, in name order; their scores are hidden. Give 1 to the strongest relationship, then 2, and so on up to {CALIBRATION_SIZE}. Rank at least 5; leave the rest blank.
              {cal.stored ? ` Last saved ${formatDate(cal.stored.at)}.` : ""}
            </p>
            <form action={saveCalibrationAction} className={formStyles.stack}>
              <div className={styles.calibration}>
                {cal.people.map((p) => (
                  <label key={p.id}>
                    <span>{p.name}</span>
                    <input type="number" name={`rank_${p.id}`} min="1" max={CALIBRATION_SIZE} step="1" defaultValue={cal.stored?.ranks[p.id] ?? ""} aria-label={`Rank for ${p.name}`} />
                  </label>
                ))}
              </div>
              <div className={formStyles.actions}>
                <SubmitButton>Save ranking</SubmitButton>
              </div>
            </form>
          </section>
          <section className="card" aria-labelledby="corr-heading">
            <h2 id="corr-heading" className="t-heading-card">How well the scores match</h2>
            <p>Rank correlation with the current weights: {describe(cal.correlation)}</p>
            <form method="get" action={`${APP_BASE_PATH}/settings/scoring`} className={formStyles.stack}>
              <input type="hidden" name="tab" value="calibration" />
              <p className="t-caption t-muted">Try other weights here without saving them. Save the ones you choose under Weights and bands.</p>
              <div className={styles.weights}>
                {WEIGHTS.map(([key, label]) => (
                  <label key={key} className={formStyles.field}>
                    <span className={formStyles.label}>{label}</span>
                    <input type="number" name={`w_${key}`} step="0.05" min="0" max="1" defaultValue={candidate?.[key] ?? w[key]} className={formStyles.input} />
                  </label>
                ))}
              </div>
              <div className={formStyles.actions}>
                <button type="submit" className="btn btn--ghost">Preview correlation</button>
              </div>
              {candidate ? <p>With these weights: {describe(cal.candidateCorrelation)}</p> : null}
            </form>
          </section>
        </div>
      ) : (
        <PermissionDenied who="partners" />
      )}
    </>
  );
}
