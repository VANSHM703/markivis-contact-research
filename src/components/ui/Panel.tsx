import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./Panel.module.css";

/** Design file 9.1: a card with a header row (eyebrow on Today, count, "View all"), then the body. */
export function Panel({ title, count, viewAll, children, eyebrow = true }: { title: string; count?: number; viewAll?: { href: string; label?: string }; children: ReactNode; eyebrow?: boolean }) {
  const id = `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section className={`card ${styles.panel}`} aria-labelledby={id}>
      <header className={styles.head}>
        <h2 id={id} className={eyebrow ? "t-eyebrow" : styles.title}>{title}</h2>
        <span className={styles.right}>
          {count !== undefined ? <span className={styles.count}>{count}</span> : null}
          {viewAll ? (
            <Link href={viewAll.href} className="btn btn--ghost btn--compact">
              {viewAll.label ?? "View all"} <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </span>
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

export function PanelEmpty({ children }: { children: string }) {
  return <p className="t-caption t-muted">{children}</p>;
}
