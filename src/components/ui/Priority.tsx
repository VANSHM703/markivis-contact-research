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

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  sec_8k: "SEC filing",
  press_wire: "Press release",
  google_alert: "Google Alert",
  leadership_page: "Leadership page",
  apollo: "Apollo",
  newsletter: "Newsletter",
  manual: "Manual",
  ai_research: "AI research",
  event_site: "Event website",
};

/** Signal types in sentence case for the interface (BRD 9.3). */
export const SIGNAL_TYPE_LABELS: Record<string, string> = {
  person_move_announced: "Move announced",
  person_left: "Left a role",
  person_joined: "Joined",
  person_board_change: "Board change",
  company_cxo_change: "Leadership change",
  company_pe_transaction: "PE transaction",
  company_mna: "Merger or acquisition",
  company_funding_ipo: "Funding or IPO",
  person_promotion: "Promotion",
  person_speaking: "Speaking",
  person_email_bounced: "Email bounced",
  company_layoffs: "Layoffs",
  company_expansion: "Expansion",
  company_hiring_surge: "Hiring surge",
  internal_relationship_quiet: "Going quiet",
  person_award: "Award",
  person_content_engagement: "Content engagement",
  company_ceo_tenure_threshold: "Long CEO tenure",
  company_product_partnership: "Partnership",
  company_intent_spike: "Intent spike",
  other: "Other",
};
