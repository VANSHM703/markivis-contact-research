import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  message: string;
  actions?: ReactNode;
}

/** One sentence saying what will appear, and at most one or two actions (design file section 9.10). */
export function EmptyState({ message, actions }: EmptyStateProps) {
  return (
    <div className={`card ${styles.empty}`}>
      <p className={styles.message}>{message}</p>
      {actions ? <div className={`${styles.actions} btn-row`}>{actions}</div> : null}
    </div>
  );
}
