import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { allowed, pageContext } from "@/server/guards";
import styles from "@/components/settings/Settings.module.css";

export const metadata: Metadata = { title: "Settings" };

// BRD 16.2: the Settings screen's sections, and the milestone that brings each one.
const SECTIONS = [
  { title: "Sources", body: "Feeds, connection checks, Apollo key and newsletter uploads.", href: "/settings/sources" },
  { title: "Members and roles", body: "Invite people and set their roles.", later: "M10" },
  { title: "Mailbox and calendar", body: "Connect Microsoft 365 for activity capture.", later: "M7" },
  { title: "Signal priorities", body: "Priority by signal type, with dismissal counts.", later: "M10" },
  { title: "Scoring", body: "Relationship score weights and calibration.", later: "M8" },
  { title: "Service levels and style guide", body: "Due dates, the digest time, the daily send limit and how drafts are written.", href: "/settings/workflow" },
  { title: "Email log", body: "Digests and alerts, with their delivery status.", href: "/settings/email" },
  { title: "Topics and content", body: "Topic vocabulary and the content library.", later: "M9" },
  { title: "Consent and suppression", body: "Lawful basis, opt-outs and erasure.", later: "M10" },
  { title: "Data export and audit log", body: "Full export and the audit trail.", later: "M10" },
];

export default async function SettingsPage() {
  const ctx = await pageContext();
  if (!allowed(ctx, "settings.change")) {
    return (
      <>
        <PageHeader title="Settings" lede="Members, connections, sources, scoring and compliance for this workspace." />
        <PermissionDenied who="partners and data stewards" />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Settings" lede={`Configuration for ${ctx.workspace.name}.`} />
      <div className={styles.sections}>
        {SECTIONS.map((s) =>
          s.href ? (
            <Link key={s.title} href={s.href} className={`card ${styles.section}`}>
              <h2 className="t-heading-card">{s.title} <span className="arrow t-meta" aria-hidden="true">→</span></h2>
              <p className="t-caption t-muted">{s.body}</p>
            </Link>
          ) : (
            <div key={s.title} className={`card ${styles.section}`}>
              <h2 className={`t-heading-card ${styles.later}`}>{s.title}</h2>
              <p className="t-caption t-muted">{s.body}</p>
              <p className="t-meta t-muted">Arrives in {s.later}</p>
            </div>
          ),
        )}
      </div>
    </>
  );
}
