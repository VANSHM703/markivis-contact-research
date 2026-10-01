import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/components/compliance/Compliance.module.css";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar } from "@/components/ui/FilterBar";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { formatDateIn, formatTimeIn, pageParam } from "@/lib/format/labels";
import { AUDIT_PAGE_SIZE, listAuditLog } from "@/server/compliance";
import { allowed, pageContext } from "@/server/guards";

export const metadata: Metadata = { title: "Audit log" };

/** Action groups by prefix, in the order of the BRD 18.3 list. */
const GROUPS: { value: string; label: string }[] = [
  { value: "auth.", label: "Sign-ins" },
  { value: "member.", label: "Members and roles" },
  { value: "person.", label: "People: changes, merges, exports, erasures" },
  { value: "signal.", label: "Validation decisions" },
  { value: "action.", label: "Actions and approvals" },
  { value: "draft.", label: "Drafts" },
  { value: "off_limits.", label: "Off-limits" },
  { value: "consent.", label: "Consent" },
  { value: "suppression.", label: "Suppression list" },
  { value: "mandate_note", label: "Mandate notes" },
  { value: "settings.", label: "Settings" },
  { value: "workspace.", label: "Workspace and exports" },
  { value: "platform_admin.", label: "Platform admin and break-glass" },
  { value: "retention.", label: "Retention review" },
  { value: "import.", label: "Imports" },
  { value: "crm.", label: "CRM" },
  { value: "shadow.", label: "Shadow run" },
];

const PERIODS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
];

const ACTOR_KIND: Record<string, string> = { system: "System", platform_admin: "Platform admin", user: "Unknown user" };

type Search = { action?: string; actor?: string; entity?: string; period?: string; page?: string };

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "audit_log.view")) return <PermissionDenied who="partners and data stewards" />;
  const params = await searchParams;
  const page = pageParam(params.page);
  const days = PERIODS.some((p) => p.value === params.period) ? Number(params.period) : undefined;
  const action = GROUPS.some((g) => g.value === params.action) ? params.action : undefined;
  const { rows, total, actors, entityTypes } = await listAuditLog(ctx.workspace.id, { action, actor: params.actor, entity: params.entity, days }, page);
  const tz = ctx.workspace.timezone;
  const query = new URLSearchParams(Object.entries({ action: action ?? "", actor: params.actor ?? "", entity: params.entity ?? "", period: params.period ?? "" }).filter(([, v]) => v)).toString();

  return (
    <>
      <PageHeader title="Audit log" lede="Append-only: nobody can change or delete an entry. After an erasure, entries about that person keep who did what and when, without the personal data." />
      <p className={`t-caption ${styles.back}`}><Link href="/settings">Back to Settings</Link></p>
      <div className={styles.stack}>
        <FilterBar
          path="/settings/audit"
          searchLabel={null}
          values={{ action, actor: params.actor, entity: params.entity, period: params.period }}
          selects={[
            { name: "action", label: "What", options: GROUPS, anyLabel: "Everything" },
            { name: "actor", label: "Who", options: [...actors.map((a) => ({ value: a.id, label: a.name })), { value: "system", label: "System" }, { value: "platform_admin", label: "Platform admin" }], anyLabel: "Anyone" },
            { name: "entity", label: "Record type", options: entityTypes.map((t) => ({ value: t, label: t.replace(/_/g, " ") })), anyLabel: "Any" },
            { name: "period", label: "When", options: PERIODS, anyLabel: "All time" },
          ]}
        />
        {rows.length === 0 ? (
          <EmptyState message="No entries match these filters." />
        ) : (
          <DataTable
            caption="Audit entries, newest first"
            columns={[{ key: "what", label: "What" }, { key: "who", label: "Who" }, { key: "record", label: "Record" }, { key: "when", label: "When", numeric: true }]}
            pagination={{ page, total, pageSize: AUDIT_PAGE_SIZE, path: "/settings/audit", query }}
            rows={rows.map((r) => ({
              id: r.id,
              cells: {
                what: (
                  <>
                    <span className="cell-title">{r.action}</span>
                    {r.before || r.after ? (
                      <details>
                        <summary className="t-caption">Details</summary>
                        <pre className={styles.json}>{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre>
                      </details>
                    ) : null}
                  </>
                ),
                who: r.actorName ?? ACTOR_KIND[r.actorKind] ?? r.actorKind,
                record: r.entityType ? `${r.entityType.replace(/_/g, " ")}${r.entityId ? ` ${r.entityId.slice(0, 8)}` : ""}` : "Workspace",
                when: `${formatDateIn(r.at, tz)} ${formatTimeIn(r.at, tz)}`,
              },
            }))}
          />
        )}
      </div>
    </>
  );
}
