import type { ReactNode } from "react";
import { navItemsForRole } from "@/config/navigation";
import { isAnyAdapterMock } from "@/config/env";
import { ROLE_LABELS, type RequestContext } from "@/lib/context";
import { signOutAction, switchWorkspaceAction } from "@/server/session-actions";
import { BrandLockup } from "./BrandLockup";
import { GlobalSearch } from "./GlobalSearch";
import { MobileNav } from "./MobileNav";
import { SidebarNav, type NavCounts } from "./SidebarNav";
import { UserMenu } from "./UserMenu";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import styles from "./AppShell.module.css";

interface AppShellProps {
  ctx: RequestContext;
  counts?: NavCounts;
  children: ReactNode;
}

/** App shell: top bar, sidebar and content area (BEAM_DESIGN_LANGUAGE.md section 7). */
export function AppShell({ ctx, counts, children }: AppShellProps) {
  const items = navItemsForRole(ctx.role);
  const mock = isAnyAdapterMock();
  const workspaceOptions = ctx.memberships.map((m) => ({ id: m.workspaceId, name: m.workspaceName, roleLabel: ROLE_LABELS[m.role] }));
  const switcher = (placement: "bar" | "drawer") =>
    ctx.memberships.length > 1 ? (
      <WorkspaceSwitcher current={ctx.workspace.id} workspaces={workspaceOptions} switchAction={switchWorkspaceAction} placement={placement} />
    ) : null;

  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={styles.topbar}>
        <div className={styles.start}>
          <MobileNav items={items} counts={counts} extra={switcher("drawer")} />
          <BrandLockup />
        </div>
        <div className={styles.centre}>
          <GlobalSearch shortcut />
        </div>
        <div className={styles.end}>
          {mock ? <span className="pill pill--mock">Mock data</span> : null}
          {ctx.memberships.length > 1 ? <div className={styles.switcherSlot}>{switcher("bar")}</div> : null}
          <UserMenu
            name={ctx.user.name}
            email={ctx.user.email}
            roleLabel={ROLE_LABELS[ctx.role]}
            workspaceName={ctx.workspace.name}
            signOutAction={signOutAction}
            packsHref={ctx.user.isPlatformAdmin ? "/settings/packs" : null}
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
