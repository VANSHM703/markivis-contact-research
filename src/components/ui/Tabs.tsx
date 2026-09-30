import Link from "next/link";
import styles from "./Tabs.module.css";

/**
 * Tabs that are routes: each tab is a link, so a tab is a URL and works without script. The
 * current tab carries aria-current (design file 9.8; see DECISIONS.md).
 */
export function Tabs({ label, tabs, current }: { label: string; tabs: { key: string; label: string; href: string }[]; current: string }) {
  return (
    <nav aria-label={label} className={styles.tabs}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={t.key === current ? `${styles.tab} ${styles.active}` : styles.tab} aria-current={t.key === current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
