import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

interface PageHeaderProps {
  title: string;
  lede?: string;
  actions?: ReactNode;
}

/** Page title in display-3, optional lede, actions on the right (design file section 7). */
export function PageHeader({ title, lede, actions }: PageHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.text}>
        <h1 className="t-display-3">{title}</h1>
        {lede ? <p className="t-lede">{lede}</p> : null}
      </div>
      {actions ? <div className={`${styles.actions} btn-row`}>{actions}</div> : null}
    </div>
  );
}
