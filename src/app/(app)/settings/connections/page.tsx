import type { Metadata } from "next";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { ExclusionForm } from "@/components/capture/ExclusionForm";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { StatePill } from "@/components/ui/Priority";
import { APP_BASE_PATH } from "@/config/product";
import { getDataMode } from "@/config/env";
import { formatDateIn, formatTimeIn } from "@/lib/format/labels";
import { connectionsFor } from "@/server/capture";
import { canSend } from "@/outreach/mailbox";
import { can } from "@/lib/permissions";
import { addExclusionAction, allowMockSendingAction, connectMockAction, disconnectAction, removeExclusionAction, syncNowAction } from "@/server/capture-actions";
import { allowed, pageContext } from "@/server/guards";
import styles from "@/components/settings/Settings.module.css";

export const metadata: Metadata = { title: "Mailbox and calendar" };

const PROVIDERS = [
  { key: "microsoft", name: "Microsoft 365", flag: "capture.microsoft", defaultOn: true },
  { key: "google", name: "Google Workspace", flag: "capture.google", defaultOn: false },
] as const;

/** Mailbox and calendar connections for the signed-in user (BRD 11.1 to 11.3). */
export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "mailbox.connect")) return <PermissionDenied who="partners and outreach owners" />;
  const { notice } = await searchParams;
  const { connections, exclusions, captured } = await connectionsFor(ctx);
  const mock = getDataMode() === "mock";
  const tz = ctx.workspace.timezone;
  const when = (d: Date | null) => (d ? `${formatDateIn(d, tz)} ${formatTimeIn(d, tz)}` : "Not yet");

  return (
    <>
      <Notice notice={notice} />
      <PageHeader
        title="Mailbox and calendar"
        lede="Connect your mailbox so conversations and meetings with tracked people are logged automatically. Only metadata is read: sender, recipients, time and subject, never the message body. Mail that involves no tracked person is ignored and nothing about it is kept."
      />
      <div className={styles.stack}>
        {PROVIDERS.filter((p) => (ctx.workspace.flags[p.flag] ?? p.defaultOn) !== false).map((p) => {
          const c = connections.find((x) => x.provider === p.key);
          const active = c?.status === "active";
          return (
            <section key={p.key} className="card" aria-labelledby={`conn-${p.key}`}>
              <h2 id={`conn-${p.key}`} className="t-heading-card">{p.name}</h2>
              <dl className={styles.readoutRows}>
                <div><dt>Status</dt><dd>{active ? <StatePill tone="ok">Connected</StatePill> : c?.status === "error" ? <StatePill tone="warn">Needs reconnecting</StatePill> : <StatePill tone="neutral">Not connected</StatePill>}</dd></div>
                {c?.accountEmail && active ? <div><dt>Mailbox</dt><dd className="t-meta">{c.accountEmail}{c.scopes.includes("mock") ? " (demo)" : ""}</dd></div> : null}
                {active ? <div><dt>Mail last synced</dt><dd className="t-meta">{when(c.lastSyncAt)}</dd></div> : null}
                {active ? <div><dt>Calendar last synced</dt><dd className="t-meta">{when(c.calendarSyncedAt)}</dd></div> : null}
                {active ? <div><dt>Sending approved emails</dt><dd>{canSend(c.scopes) ? <StatePill tone="ok">Allowed</StatePill> : <StatePill tone="neutral">Not allowed</StatePill>}</dd></div> : null}
              </dl>
              {c?.errorMessage ? <p className={styles.warnText}>{c.errorMessage}</p> : null}
              <div className="btn-row">
                {active ? (
                  <>
                    <form action={syncNowAction.bind(null, p.key)}><SubmitButton variant="ghost">Sync now</SubmitButton></form>
                    {!canSend(c.scopes) && can(ctx.role, "messages.send") ? (
                      c.scopes.includes("mock") ? (
                        <form action={allowMockSendingAction.bind(null, p.key)}><SubmitButton variant="ghost">Allow sending</SubmitButton></form>
                      ) : (
                        <a className="btn btn--ghost" href={`${APP_BASE_PATH}/api/v1/connections/${p.key}/start?send=1`}>Allow sending</a>
                      )
                    ) : null}
                    <form action={disconnectAction.bind(null, p.key)}><SubmitButton variant="danger">Disconnect</SubmitButton></form>
                  </>
                ) : mock ? (
                  <form action={connectMockAction.bind(null, p.key)}><SubmitButton>{`Connect demo ${p.key === "microsoft" ? "Microsoft 365" : "Google"} mailbox`}</SubmitButton></form>
                ) : (
                  <a className="btn btn--primary" href={`${APP_BASE_PATH}/api/v1/connections/${p.key}/start`}>{`Connect ${p.name}`}</a>
                )}
              </div>
              <p className="t-caption t-muted">Disconnecting deletes the stored access at once and stops syncing. Interactions already logged stay on the records.</p>
            </section>
          );
        })}
        <p className="t-caption t-muted">{captured} interactions captured from your mailbox and calendar so far.</p>
        <section className="card" aria-labelledby="exclusions">
          <h2 id="exclusions" className="t-heading-card">Never capture</h2>
          <p className="t-caption t-muted">Personal addresses and domains, such as family or your own advisers. Only you see this list.</p>
          <ExclusionForm action={addExclusionAction} />
          {exclusions.length ? (
            <ul className={styles.feedList}>
              {exclusions.map((e) => (
                <li key={e.id} className={styles.emailRow}>
                  <span className="t-meta">{e.pattern}</span>
                  <form action={removeExclusionAction.bind(null, e.id)}><SubmitButton variant="ghost" compact>Remove</SubmitButton></form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="t-caption t-muted">No exclusions.</p>
          )}
        </section>
      </div>
    </>
  );
}
