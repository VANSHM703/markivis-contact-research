import type { Metadata } from "next";
import Link from "next/link";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { Tabs } from "@/components/ui/Tabs";
import type { ConflictPayload, DuplicatePayload } from "@/domain/queue-items";
import { formatDate } from "@/lib/format/labels";
import { can } from "@/lib/permissions";
import { resolveConflictAction, resolveDuplicateAction } from "@/server/queue-actions";
import { listRecordQueueItems } from "@/server/records";
import { pageContext } from "@/server/guards";
import { workingDaysBetween } from "@/server/today";
import styles from "../record.module.css";

export const metadata: Metadata = { title: "Queue" };

// Lane labels from the design file, section 12.
const TABS = [
  { key: "review", label: "Review" },
  { key: "batch", label: "Weekly batch" },
  { key: "research", label: "More research" },
  { key: "parked", label: "Parked" },
  { key: "spot", label: "Spot checks" },
  { key: "conflicts", label: "Conflicts and duplicates" },
];

const FIELD_LABELS: Record<string, string> = { full_name: "Full name", linkedin_url: "LinkedIn profile", city: "City", country: "Country", title: "Title", business_email: "Business email", ended_on: "End date", name: "Name", domain: "Domain", sec_cik: "SEC CIK" };
const SOURCE_LABELS: Record<string, string> = { manual: "Manual", apollo: "Apollo", sec_8k: "SEC filing", press_wire: "Press release", google_alert: "News or alert", leadership_page: "Leadership page", event_site: "Event website" };

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ tab?: string; notice?: string }> }) {
  const ctx = await pageContext();
  if (!can(ctx.role, "queue.work")) {
    return (
      <>
        <PageHeader title="Queue" lede="Validate detected changes before they reach the partner." />
        <PermissionDenied who="partners and validators" />
      </>
    );
  }
  const { tab: tabParam, notice } = await searchParams;
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam! : "review";
  const { items, people, sources, roleNames, companyNames } = await listRecordQueueItems(ctx.workspace.id);
  const now = new Date();
  const person = new Map(people.map((p) => [p.id, p]));
  const source = new Map(sources.map((s) => [s.id, s]));
  const roleName = new Map(roleNames.map((r) => [r.id, r]));
  const companyName = new Map(companyNames.map((c) => [c.id, c.name]));
  const canMerge = can(ctx.role, "persons.merge");

  return (
    <>
      <Notice notice={notice} />
      <PageHeader title="Queue" lede="Validate detected changes before they reach the partner. Oldest first." />
      <Tabs
        label="Queue lanes"
        current={tab}
        tabs={TABS.map((t) => ({ key: t.key, label: t.key === "conflicts" && items.length ? `${t.label} (${items.length})` : t.label, href: `/queue?tab=${t.key}` }))}
      />
      {tab !== "conflicts" ? (
        <EmptyState message="The queue is clear." />
      ) : items.length === 0 ? (
        <EmptyState message="No conflicts or possible duplicates." />
      ) : (
        <ul className={styles.queueList}>
          {items.map((item) => {
            const age = workingDaysBetween(item.createdAt, now);
            if (item.kind === "possible_duplicate") {
              const payload = item.payload as DuplicatePayload;
              const pair = payload.person_ids.map((id) => person.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
              return (
                <li key={item.id} className="card">
                  <div className={styles.queueHeader}>
                    <h2 className="t-heading-card">Possible duplicate</h2>
                    <span className="t-meta t-muted">{age} working days old</span>
                  </div>
                  <p className="t-caption t-muted">Same name, and the same company or city. Nothing was merged automatically.</p>
                  <div className={styles.columns}>
                    {pair.map((p) => (
                      <dl key={p.id} className={styles.readout}>
                        <div><dt>Name</dt><dd><Link href={`/people/${p.id}`}>{p.fullName}</Link></dd></div>
                        <div><dt>Primary role</dt><dd>{p.title ? `${p.title}, ${p.companyName}` : "None"}</dd></div>
                        <div><dt>City</dt><dd>{p.city ?? "Not recorded"}</dd></div>
                        <div><dt>LinkedIn</dt><dd>{p.linkedinUrl ? "Recorded" : "Not recorded"}</dd></div>
                        <div><dt>Added</dt><dd className="t-meta">{formatDate(p.createdAt)}</dd></div>
                      </dl>
                    ))}
                  </div>
                  {canMerge ? (
                    <div className={`btn-row ${styles.decisionBar}`}>
                      {pair.map((p) => (
                        <form key={p.id} action={resolveDuplicateAction.bind(null, item.id)}>
                          <input type="hidden" name="decision" value={p.id} />
                          <SubmitButton variant="ghost">{`Merge, keeping ${p.fullName} added ${formatDate(p.createdAt)}`}</SubmitButton>
                        </form>
                      ))}
                      <form action={resolveDuplicateAction.bind(null, item.id)}>
                        <input type="hidden" name="decision" value="keep_separate" />
                        <SubmitButton variant="ghost">Keep separate</SubmitButton>
                      </form>
                    </div>
                  ) : null}
                </li>
              );
            }
            const payload = item.payload as ConflictPayload;
            const subject =
              payload.entity_type === "person"
                ? { label: person.get(payload.entity_id)?.fullName ?? "Person", href: `/people/${payload.entity_id}` }
                : payload.entity_type === "role"
                  ? { label: roleName.get(payload.entity_id) ? `${roleName.get(payload.entity_id)!.fullName}, ${roleName.get(payload.entity_id)!.title} at ${roleName.get(payload.entity_id)!.companyName}` : "Role", href: roleName.get(payload.entity_id) ? `/people/${roleName.get(payload.entity_id)!.personId}?tab=record` : "/people" }
                  : { label: companyName.get(payload.entity_id) ?? "Company", href: `/companies/${payload.entity_id}` };
            return (
              <li key={item.id} className="card">
                <div className={styles.queueHeader}>
                  <h2 className="t-heading-card">Sources disagree: {FIELD_LABELS[payload.field] ?? payload.field}</h2>
                  <span className="t-meta t-muted">{age} working days old</span>
                </div>
                <p>
                  <Link href={subject.href}>{subject.label}</Link>
                </p>
                <div className={`btn-row ${styles.decisionBar}`}>
                  {payload.field_source_ids.map((id) => {
                    const s = source.get(id);
                    if (!s) return null;
                    return (
                      <form key={id} action={resolveConflictAction.bind(null, item.id)} className={styles.choice}>
                        <input type="hidden" name="field_source_id" value={id} />
                        <p className={styles.sourceValue}>{s.value ?? "Empty"}</p>
                        <p className="t-meta t-muted">
                          {SOURCE_LABELS[s.sourceType] ?? s.sourceType} · {s.confidence.toUpperCase()} · {formatDate(s.capturedAt)}
                          {s.isCurrent ? " · SHOWN NOW" : ""}
                        </p>
                        <SubmitButton variant="ghost">Use this value</SubmitButton>
                      </form>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
