import styles from "./Priority.module.css";

/** P1 filled violet, P2 violet outline, P3 muted outline, always with the label (design file 4.2). */
export function PriorityPill({ priority }: { priority: number }) {
  const cls = priority === 1 ? styles.p1 : priority === 2 ? styles.p2 : styles.p3;
  return <span className={`${styles.pill} ${cls}`}>P{priority}</span>;
}

/** Confidence in mono, coloured and always in words (design file 4.2). */
export function ConfidenceText({ confidence }: { confidence: string }) {
  const cls = confidence === "high" ? styles.high : confidence === "low" ? styles.low : styles.medium;
  return <span className={`${styles.confidence} ${cls}`}>{confidence.charAt(0).toUpperCase() + confidence.slice(1)}</span>;
}

export { SIGNAL_TYPE_LABELS, SOURCE_TYPE_LABELS } from "@/lib/format/labels";

const BAND_WORDS: Record<string, string> = { strong: "Strong", warm: "Warm", cooling: "Cooling", cold: "Cold", none: "None" };

/** Relationship band, always in words (design file 4.2). A missing score reads "Not scored". */
export function BandPill({ band }: { band: string | null }) {
  if (!band) return <span className={`${styles.band} ${styles.bandNone}`}>Not scored</span>;
  const cls = { strong: styles.bandStrong, warm: styles.bandWarm, cooling: styles.bandCooling, cold: styles.bandCold, none: styles.bandNone }[band] ?? styles.bandNone;
  return <span className={`${styles.band} ${cls}`}>{BAND_WORDS[band] ?? band}</span>;
}

/** State pill: ok (sent, done), warn (overdue, needs attention), blocked (consent, off-limits). */
export function StatePill({ tone, children }: { tone: "ok" | "warn" | "blocked" | "neutral"; children: string }) {
  const cls = { ok: styles.stateOk, warn: styles.stateWarn, blocked: styles.stateBlocked, neutral: styles.stateNeutral }[tone];
  return <span className={`${styles.state} ${cls}`}>{tone === "ok" ? `✓ ${children}` : children}</span>;
}
