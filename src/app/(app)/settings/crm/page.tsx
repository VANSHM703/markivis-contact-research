import type { Metadata } from "next";
import Link from "next/link";
import formStyles from "@/components/forms/Form.module.css";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { StatePill } from "@/components/ui/Priority";
import { getDataMode } from "@/config/env";
import { withWorkspace } from "@/db/client";
import { hasWorkspaceSecret } from "@/domain/secrets";
import { formatDateIn, formatTimeIn } from "@/lib/format/labels";
import { saveHubSpotTokenAction, syncHubSpotAction } from "@/server/crm-actions";
import { allowed, pageContext } from "@/server/guards";
import styles from "@/components/settings/Settings.module.css";

export const metadata: Metadata = { title: "CRM" };

/** HubSpot sync (BRD 15, P1): the private app token, the switch and the last run. */
export default async function CrmPage({ searchParams }: { searchParams: Promise<{ notice?: string; why?: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "settings.change")) return <PermissionDenied who="partners and data stewards" />;
  const { notice, why } = await searchParams;
  const on = ctx.workspace.flags["crm.hubspot"] === true;
  const mock = getDataMode() === "mock";
  const token = await withWorkspace(ctx.workspace.id, (tx) => hasWorkspaceSecret(tx, ctx.workspace.id, "hubspot_private_app_token"));
  const state = (ctx.workspace.settings.crm ?? {}) as { last_out_at?: string; last_error?: string | null; last_result?: Record<string, number> };
  const tz = ctx.workspace.timezone;
  const last = state.last_out_at ? new Date(state.last_out_at) : null;

  return (
    <>
      <Notice notice={notice} />
      <PageHeader title="CRM" lede="HubSpot stays the record for contacts and logged activity; this tool sends it titles, relationship bands, last two-way touches and logged interactions, and reads back unsubscribes and title changes. Neither side overwrites the other: a disagreement goes to the queue." />
      <p className="t-caption"><Link href="/settings">Back to Settings</Link></p>
      <div className={styles.stack}>
        <section className="card" aria-labelledby="hs-status">
          <h2 id="hs-status" className="t-heading-card">HubSpot</h2>
          <dl className={styles.readoutRows}>
            <div><dt>Sync</dt><dd>{on ? <StatePill tone="ok">On</StatePill> : <StatePill tone="neutral">Off</StatePill>}</dd></div>
            <div><dt>Private app token</dt><dd>{mock ? "Not needed in mock mode" : token.set ? `Saved ${token.updatedAt ? formatDateIn(token.updatedAt, tz) : ""}` : "Not saved"}</dd></div>
            <div><dt>Last sync</dt><dd className="t-meta">{last ? `${formatDateIn(last, tz)} ${formatTimeIn(last, tz)}` : "Never"}</dd></div>
            {state.last_result ? <div><dt>Last result</dt><dd className="t-meta">{state.last_result.contacts ?? 0} contacts, {state.last_result.notes ?? 0} notes, {state.last_result.optOuts ?? 0} unsubscribes, {state.last_result.conflicts ?? 0} conflicts</dd></div> : null}
          </dl>
          {!on ? <p className="t-caption t-muted">A platform admin switches HubSpot sync on, on Settings, Packs.</p> : null}
          {state.last_error ? <p className={styles.warnText}>Last error: {state.last_error}</p> : null}
          {why === "token" ? <p className={styles.warnText}>That does not look like a HubSpot private app token. Copy it from HubSpot, Settings, Integrations, Private apps.</p> : null}
          {why === "encryption" ? <p className={styles.warnText}>Tokens cannot be stored until TOKEN_ENCRYPTION_KEY is set for this deployment.</p> : null}
          {on ? (
            <form action={syncHubSpotAction}><SubmitButton variant="ghost">Sync now</SubmitButton></form>
          ) : null}
        </section>
        {!mock ? (
          <section className="card" aria-labelledby="hs-token">
            <h2 id="hs-token" className="t-heading-card">Private app token</h2>
            <p className="t-caption t-muted">Create a private app in HubSpot with the scopes crm.objects.contacts.read, crm.objects.contacts.write and crm.schemas.contacts.write. The token is stored encrypted and never shown again.</p>
            <form action={saveHubSpotTokenAction} className={formStyles.stack}>
              <label className={formStyles.field}>
                <span className={formStyles.label}>Token</span>
                <input type="password" name="token" required autoComplete="off" className={formStyles.input} />
              </label>
              <div className={formStyles.actions}>
                <SubmitButton>Save token</SubmitButton>
              </div>
            </form>
          </section>
        ) : null}
      </div>
    </>
  );
}
