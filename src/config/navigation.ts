export type WorkspaceRole = "partner" | "outreach_owner" | "validator" | "account_lead" | "data_steward";

export type NavIcon = "today" | "actions" | "queue" | "people" | "companies" | "signals" | "paths" | "coverage" | "settings";

export interface NavItem {
  label: string;
  href: string;
  /** Lucide icon name, resolved in the client component (components cannot cross the server boundary). */
  icon: NavIcon;
  /** Roles that see the item. Undefined means every role. */
  roles?: readonly WorkspaceRole[];
  /** Settings sits apart at the bottom of the sidebar. */
  section: "main" | "footer";
}

/** Primary navigation in the order fixed by BRD section 16.1. */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Today", href: "/", icon: "today", section: "main" },
  { label: "Actions", href: "/actions", icon: "actions", section: "main" },
  { label: "Queue", href: "/queue", icon: "queue", roles: ["partner", "validator"], section: "main" },
  { label: "People", href: "/people", icon: "people", section: "main" },
  { label: "Companies", href: "/companies", icon: "companies", section: "main" },
  { label: "Signals", href: "/signals", icon: "signals", section: "main" },
  { label: "Paths", href: "/paths", icon: "paths", section: "main" },
  { label: "Coverage", href: "/coverage", icon: "coverage", section: "main" },
  { label: "Settings", href: "/settings", icon: "settings", roles: ["partner", "data_steward"], section: "footer" },
];

export function navItemsForRole(role: WorkspaceRole): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}

/** Whether a nav item is the current page. Today matches only its own route. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
