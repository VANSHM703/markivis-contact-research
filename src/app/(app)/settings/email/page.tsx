import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { StatePill } from "@/components/ui/Priority";
import { getDataMode } from "@/config/env";
import { formatDateIn, formatTimeIn } from "@/lib/format/labels";
import { allowed, pageContext } from "@/server/guards";
import { getNotification, listNotifications } from "@/server/notifications";
import styles from "@/components/settings/Settings.module.css";

export const metadata: Metadata = { title: "Email log" };

const KIND_LABELS: Record<string, string> = { digest: "Daily digest", p1_change: "Priority 1 alert", auto_confirm_suspended: "Auto-confirm suspended", budget_80: "Budget at 80%", brief: "Meeting brief", break_glass: "Break-glass access", invitation: "Invitation", retention_review: "Retention review" };

export default async function EmailLogPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "settings.change")) return <PermissionDenied who="partners and data stewards" />;
  const { id } = await searchParams;
  const tz = ctx.workspace.timezone;
  const [rows, open] = await Promise.all([listNotifications(ctx.workspace.id), id ? getNotification(ctx.workspace.id, id) : null]);
  const mock = getDataMode() === "mock";

  return (
    <>
      <PageHeader title="Email log" lede={mock ? "Digests and alerts this workspace would send. In mock mode nothing leaves this machine." : "Digests and alerts sent from this workspace, newest first."} />
      <p className="t-caption"><Link href="/settings">Back to Settings</Link></p>
      {open ? (
        <section className="card" aria-labelledby="email-heading">
          <h2 id="email-heading" className="t-heading-card">{open.subject}</h2>
          <p className="t-meta t-muted">To {open.toEmail} · {KIND_LABELS[open.kind]} · {formatDateIn(open.createdAt, tz)} {formatTimeIn(open.createdAt, tz)}</p>
          <pre className={styles.emailBody}>{open.bodyText}</pre>
          <Link href="/settings/email">Close</Link>
        </section>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState message="No emails yet. The digest goes out at the workspace digest time when someone has something to do." />
      ) : (
        <ul className={styles.feedList}>
          {rows.map((r) => (
            <li key={r.id} className={styles.emailRow}>
              <Link href={`/settings/email?id=${r.id}`}>{r.subject}</Link>
              <span className="t-meta t-muted">{KIND_LABELS[r.kind]} · to {r.toEmail} · {formatDateIn(r.createdAt, tz)} {formatTimeIn(r.createdAt, tz)}</span>
              <span>{r.status === "sent" ? <StatePill tone="ok">Sent</StatePill> : r.status === "failed" ? <StatePill tone="warn">{`Failed: ${r.error ?? "unknown error"}`}</StatePill> : <StatePill tone="neutral">Queued</StatePill>}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
