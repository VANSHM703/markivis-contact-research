import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLockup } from "@/components/shell/BrandLockup";
import { isAnyAdapterMock } from "@/config/env";
import { getRequestContext, getSignedInUser } from "@/lib/context";
import { signOutAction } from "@/server/session-actions";
import styles from "./layout.module.css";

/** Platform pages (BRD 5.3): for platform admins, with or without a workspace. */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const user = await getSignedInUser();
  if (!user) redirect("/sign-in");
  if (!user.isPlatformAdmin) redirect("/?notice=not_allowed");
  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className={styles.topbar}>
        <BrandLockup />
        <div className={styles.end}>
          {isAnyAdapterMock() ? <span className="pill pill--mock">Mock data</span> : null}
          {(await getRequestContext()) ? <Link href="/" className="t-caption">Back to the workspace</Link> : null}
          <form action={signOutAction}>
            <button type="submit" className="btn btn--ghost btn--compact">Sign out</button>
          </form>
        </div>
      </header>
      <main id="main" className={styles.content} tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
