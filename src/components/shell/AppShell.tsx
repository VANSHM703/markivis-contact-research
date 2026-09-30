import type { ReactNode } from "react";
import { navItemsForRole } from "@/config/navigation";
import { isAnyAdapterMock } from "@/config/env";
import { ROLE_LABELS, type SessionUser } from "@/lib/session";
import { BrandLockup } from "./BrandLockup";
import { GlobalSearch } from "./GlobalSearch";
import { MobileNav } from "./MobileNav";
import { SidebarNav, type NavCounts } from "./SidebarNav";
import { UserMenu } from "./UserMenu";
import styles from "./AppShell.module.css";

interface AppShellProps {
  user: SessionUser;
  counts?: NavCounts;
  children: ReactNode;
}

/** App shell: top bar, sidebar and content area (BEAM_DESIGN_LANGUAGE.md section 7). */
export function AppShell({ user, counts, children }: AppShellProps) {
  const items = navItemsForRole(user.role);
  const mock = isAnyAdapterMock();

  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={styles.topbar}>
        <div className={styles.start}>
          <MobileNav items={items} counts={counts} />
          <BrandLockup />
        </div>
        <div className={styles.centre}>
          <GlobalSearch shortcut />
        </div>
        <div className={styles.end}>
          {mock ? <span className="pill pill--mock">Mock data</span> : null}
          <UserMenu
            name={user.name}
            email={user.email}
            roleLabel={ROLE_LABELS[user.role]}
            workspaceName={user.workspaceName}
          />
        </div>
      </header>
      <div className={styles.body}>
        <nav aria-label="Primary" className={styles.sidebar}>
          <SidebarNav items={items} counts={counts} />
        </nav>
        <main id="main" className={styles.content} tabIndex={-1}>
          <div className={styles.inner}>{children}</div>
        </main>
      </div>
    </div>
  );
}
