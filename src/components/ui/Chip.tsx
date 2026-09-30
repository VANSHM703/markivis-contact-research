import styles from "./Chip.module.css";

/** Flag chip (design file 9.3). "blocked" is the Off-limits and Do not contact treatment. */
export function Chip({ children, tone = "neutral" }: { children: string; tone?: "neutral" | "blocked" }) {
  return <span className={tone === "blocked" ? `${styles.chip} ${styles.blocked}` : styles.chip}>{children}</span>;
}
