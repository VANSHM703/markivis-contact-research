import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { execSearchOn } from "@/lib/packs";
import type { Capability } from "@/lib/permissions";
import { allowed, pageContext } from "@/server/guards";
import styles from "@/components/settings/Settings.module.css";

export const metadata: Metadata = { title: "Settings" };

// BRD 16.2: the Settings screen's sections, each shown to the roles that can use it.
type Section = { title: string; body: string; href: string; capability?: Capability };

const PACK_SECTIONS: Section[] = [
  { title: "Off-limits rules", body: "Companies whose executives are not approached as candidates. Partners only.", href: "/settings/off-limits", capability: "off_limits.set" },
  { title: "Placements", body: "Import the executives your firm has placed.", href: "/people/placements/import", capability: "records.edit" },
];

const SECTIONS: Section[] = [
  { title: "Members and roles", body: "Invite people, set their roles and remove access.", href: "/settings/members", capability: "members.manage" },
  { title: "Sources", body: "Feeds, connection checks, Apollo key and newsletter uploads.", href: "/settings/sources", capability: "settings.change" },
  { title: "Mailbox and calendar", body: "Connect your mailbox and calendar for activity capture, and choose what is never captured.", href: "/settings/connections", capability: "mailbox.connect" },
  { title: "Signal priorities", body: "Priority by signal type, with how often each type's actions are dismissed.", href: "/settings/priorities", capability: "settings.change" },
  { title: "Scoring", body: "Relationship score weights, bands and calibration.", href: "/settings/scoring", capability: "settings.change" },
  { title: "Service levels and style guide", body: "Due dates, the digest time, the daily send limit and how drafts are written.", href: "/settings/workflow", capability: "settings.change" },
  { title: "Topics and content", body: "The topic vocabulary and the content library that drafts suggest.", href: "/settings/content", capability: "settings.change" },
  { title: "CRM", body: "HubSpot sync: token, status and Sync now.", href: "/settings/crm", capability: "settings.change" },
  { title: "Email log", body: "Digests and alerts, with their delivery status.", href: "/settings/email", capability: "settings.change" },
  { title: "Consent and suppression", body: "The suppression list: check an address, add an opt-out, see counts by reason.", href: "/settings/consent", capability: "compliance.manage" },
  { title: "Retention review", body: "People with no current role and no contact for 24 months, to keep or erase.", href: "/settings/retention", capability: "compliance.manage" },
  { title: "Data export", body: "Download the whole workspace: every table as CSV and JSON, with a schema description.", href: "/settings/export", capability: "data.export_all" },
  { title: "Audit log", body: "Who did what and when: sign-ins, role changes, decisions, sends, exports and erasures.", href: "/settings/audit", capability: "audit_log.view" },
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
  const sections = [
    ...SECTIONS,
    ...(execSearchOn(ctx.workspace) ? PACK_SECTIONS : []),
    ...(ctx.user.isPlatformAdmin ? [{ title: "Packs", body: "Switch workspace modules on or off. Platform admins only.", href: "/settings/packs" }] : []),
  ].filter((s) => !("capability" in s) || !s.capability || allowed(ctx, s.capability));
  return (
    <>
      <PageHeader title="Settings" lede={`Configuration for ${ctx.workspace.name}.`} />
      <div className={styles.sections}>
        {sections.map((s) => (
          <Link key={s.title} href={s.href} className={`card ${styles.section}`}>
            <h2 className="t-heading-card">{s.title} <span className="arrow t-meta" aria-hidden="true">→</span></h2>
            <p className="t-caption t-muted">{s.body}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
