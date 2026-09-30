"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CalendarCheck,
  GitFork,
  Inbox,
  LayoutGrid,
  ListChecks,
  Radio,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { isNavItemActive, type NavIcon, type NavItem } from "@/config/navigation";
import styles from "./SidebarNav.module.css";

const ICONS: Record<NavIcon, LucideIcon> = {
  today: CalendarCheck,
  actions: ListChecks,
  queue: Inbox,
  people: Users,
  companies: Building2,
  signals: Radio,
  paths: GitFork,
  coverage: LayoutGrid,
  settings: Settings,
};

export interface NavCounts {
  [href: string]: { value: number; overdue?: boolean } | undefined;
}

interface SidebarNavProps {
  items: readonly NavItem[];
  counts?: NavCounts;
  onNavigate?: () => void;
}

export function SidebarNav({ items, counts = {}, onNavigate }: SidebarNavProps) {
  const pathname = usePathname() ?? "/";
  const groups = [items.filter((i) => i.section === "main"), items.filter((i) => i.section === "footer")];

  return (
    <div className={styles.nav}>
      {groups.map((group, index) =>
        group.length === 0 ? null : (
          <ul key={index} className={index === 1 ? `${styles.list} ${styles.footer}` : styles.list}>
            {group.map((item) => {
              const active = isNavItemActive(item, pathname);
              const count = counts[item.href];
              const Icon = ICONS[item.icon];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={active ? `${styles.item} ${styles.active}` : styles.item}
                    aria-current={active ? "page" : undefined}
                    onClick={onNavigate}
                  >
                    <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                    <span className={styles.label}>{item.label}</span>
                    {count && count.value > 0 ? (
                      <span className={count.overdue ? `${styles.count} ${styles.overdue}` : styles.count}>
                        {count.value}
                        <span className="visually-hidden">{count.overdue ? " overdue" : " open"}</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        ),
      )}
    </div>
  );
}
