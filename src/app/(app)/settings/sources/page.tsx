import type { Metadata } from "next";
import Link from "next/link";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { HealthCheck } from "@/components/settings/HealthCheck";
import { AddFeedForm, ApolloKeyForm, NewsletterUploadForm } from "@/components/settings/SourceForms";
import { Chip } from "@/components/ui/Chip";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { getDataMode } from "@/config/env";
import { SOURCE_FLAGS } from "@/ingest/types";
import { FAILURE_ALERT_THRESHOLD } from "@/ingest/run";
import { formatDate } from "@/lib/format/labels";
import { addFeedAction, checkHealthAction, runNowAction, saveApolloKeyAction, toggleFeedAction, uploadNewsletterAction } from "@/server/source-actions";
import { getSourcesOverview } from "@/server/sources";
import { allowed, pageContext } from "@/server/guards";
import styles from "@/components/settings/Settings.module.css";
import recordStyles from "../../record.module.css";

export const metadata: Metadata = { title: "Sources" };

const LABELS: Record<string, string> = {
  sec_8k: "SEC filings",
  press_wire: "Press release wire",
  google_alert: "Google Alerts",
  leadership_page: "Leadership pages",
  newsletter: "Newsletter",
  apollo: "Apollo",
};

const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "settings.change")) return <PermissionDenied who="partners and data stewards" />;
  const { notice } = await searchParams;
  const overview = await getSourcesOverview(ctx.workspace.id);
  const cap = (ctx.workspace.settings.apollo as { monthly_credit_cap?: number | null } | undefined)?.monthly_credit_cap ?? null;
  const mode = getDataMode();

  return (
    <>
      <Notice notice={notice} />
      <PageHeader
        title="Sources"
        lede={`${overview.feeds.length} sources. ${overview.rawItems7d} items collected in the last 7 days.${mode === "mock" ? " Mock mode: every source reads fictional fixtures." : ""}`}
        actions={<Link href="/settings" className="btn btn--ghost">All settings</Link>}
      />
      <div className={recordStyles.stack}>
        <section className="card" aria-labelledby="feeds-heading">
          <h2 id="feeds-heading" className="t-heading-card">Sources and health</h2>
          <ul className={styles.feedList}>
            {overview.feeds.map(({ feed, items7d }) => {
              const flag = SOURCE_FLAGS[feed.sourceType];
              const flagOff = flag ? ctx.workspace.flags[flag] !== true : false;
              const failing = feed.consecutiveFailures >= FAILURE_ALERT_THRESHOLD;
              return (
                <li key={feed.id} className={styles.feed}>
                  <div>
                    <p className={styles.feedName}>{feed.name}</p>
                    <p className="t-caption t-muted">{LABELS[feed.sourceType] ?? feed.sourceType}</p>
                    <p>
                      {!feed.enabled ? <Chip>Off</Chip> : flagOff ? <Chip>Switched off for this workspace</Chip> : null}
                      {failing ? <Chip tone="blocked">{`Failed ${feed.consecutiveFailures} runs in a row`}</Chip> : feed.lastError ? <Chip tone="blocked">Last run failed</Chip> : null}
                    </p>
                  </div>
                  <dl className={recordStyles.readout}>
                    <div><dt>Last good run</dt><dd className="t-meta">{feed.lastSuccessAt ? dateTime.format(feed.lastSuccessAt) : "Never"}</dd></div>
                    <div><dt>Items, last 7 days</dt><dd className="t-meta">{items7d}</dd></div>
                    {feed.lastError ? <div><dt>Last error</dt><dd className="t-meta">{feed.lastError.slice(0, 160)}</dd></div> : null}
                  </dl>
                  <div className={styles.feedActions}>
                    <HealthCheck action={checkHealthAction.bind(null, feed.id)} label={feed.name} />
                    {feed.sourceType !== "newsletter" ? (
                      <form action={runNowAction.bind(null, feed.id)}>
                        <SubmitButton variant="ghost">Run now</SubmitButton>
                      </form>
                    ) : null}
                    <form action={toggleFeedAction.bind(null, feed.id, !feed.enabled)}>
                      <SubmitButton variant="ghost">{feed.enabled ? "Switch off" : "Switch on"}</SubmitButton>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <div className={recordStyles.columns}>
          <section className="card" aria-labelledby="apollo-heading">
            <h2 id="apollo-heading" className="t-heading-card">Apollo</h2>
            <div className={styles.meter}>
              <p className="t-caption">
                Credits this month: <span className="t-figure">{overview.apolloCreditsUsed}</span>
                {cap !== null ? <span className="t-muted"> of {cap}</span> : <span className="t-muted"> (no monthly cap set)</span>}
              </p>
              {cap ? (
                <div className={styles.track} role="img" aria-label={`${overview.apolloCreditsUsed} of ${cap} credits used`}>
                  <div className={styles.bar} style={{ width: `${Math.min(100, (overview.apolloCreditsUsed / cap) * 100)}%` }} />
                </div>
              ) : null}
            </div>
            <ApolloKeyForm action={saveApolloKeyAction} saved={overview.apolloKey.set && overview.apolloKey.updatedAt ? `saved ${formatDate(overview.apolloKey.updatedAt)}` : null} />
          </section>
          <section className="card" aria-labelledby="newsletter-heading">
            <h2 id="newsletter-heading" className="t-heading-card">Newsletter events</h2>
            <NewsletterUploadForm action={uploadNewsletterAction} />
          </section>
        </div>

        <section className="card" aria-labelledby="add-feed-heading">
          <h2 id="add-feed-heading" className="t-heading-card">Add a feed</h2>
          <p className="t-caption t-muted">Leadership pages are set on each company&apos;s edit page. SEC filings are watched for every company with a CIK.</p>
          <AddFeedForm action={addFeedAction} />
        </section>
      </div>
    </>
  );
}
