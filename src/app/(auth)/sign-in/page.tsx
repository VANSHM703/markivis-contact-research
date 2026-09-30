import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandLockup } from "@/components/shell/BrandLockup";
import { isMockSignInEnabled } from "@/lib/auth";
import { getRequestContext, ROLE_LABELS } from "@/lib/context";
import { listMockSignInUsers } from "@/lib/identity";
import { mockSignInAction, providerSignInAction } from "@/server/session-actions";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  AccessDenied: "This email address is not on the workspace allow list. Ask your data steward for an invitation.",
  Configuration: "Sign-in is not configured. Ask the platform administrator to check the identity provider settings.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getRequestContext()) redirect("/");
  const { error } = await searchParams;
  const mock = isMockSignInEnabled();
  const mockUsers = mock ? await listMockSignInUsers() : [];
  const microsoft = Boolean(process.env.AUTH_MICROSOFT_CLIENT_ID);
  const google = Boolean(process.env.AUTH_GOOGLE_CLIENT_ID);

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <BrandLockup />
        <div className={styles.heading}>
          <h1 className="t-display-3">Sign in</h1>
          <p className="t-lede">Use your work account. Sessions end after 12 hours without activity.</p>
        </div>

        {error ? (
          <p role="alert" className={styles.error}>
            {ERRORS[error] ?? "Couldn't sign you in. Try again, or ask your data steward to check your access."}
          </p>
        ) : null}

        {microsoft || google ? (
          <div className={`${styles.providers} btn-row`}>
            {microsoft ? (
              <form action={providerSignInAction}>
                <input type="hidden" name="provider" value="microsoft-entra-id" />
                <button type="submit" className="btn btn--primary">Continue with Microsoft</button>
              </form>
            ) : null}
            {google ? (
              <form action={providerSignInAction}>
                <input type="hidden" name="provider" value="google" />
                <button type="submit" className={microsoft ? "btn btn--ghost" : "btn btn--primary"}>Continue with Google</button>
              </form>
            ) : null}
          </div>
        ) : null}

        {mock ? (
          <section className={styles.mock} aria-labelledby="mock-heading">
            <div className={styles.mockHeader}>
              <h2 id="mock-heading" className="t-heading-card">Continue as a demo user</h2>
              <span className="pill pill--mock">Mock data</span>
            </div>
            <p className="t-caption t-muted">Mock mode only. Every name, company and email here is fictional.</p>
            <ul className={styles.users}>
              {mockUsers.map((u) => (
                <li key={u.email}>
                  <form action={mockSignInAction}>
                    <input type="hidden" name="email" value={u.email} />
                    <button type="submit" className={styles.user}>
                      <span className={styles.userName}>{u.name}</span>
                      <span className="t-caption t-muted">
                        {ROLE_LABELS[u.role]}, {u.workspaceName}
                      </span>
                      <span className={`${styles.arrow} t-meta`} aria-hidden="true">→</span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!mock && !microsoft && !google ? (
          <p className={styles.error} role="alert">{ERRORS.Configuration}</p>
        ) : null}

        <p className="t-caption t-muted">BEAM by Markivis</p>
      </div>
    </main>
  );
}
