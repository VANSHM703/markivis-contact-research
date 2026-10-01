import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Chip } from "@/components/ui/Chip";
import { Notice } from "@/components/ui/Notice";
import { Tabs } from "@/components/ui/Tabs";
import { BriefTab } from "@/components/briefs/BriefTab";
import { PrivacyTab } from "@/components/compliance/PrivacyTab";
import { Interactions } from "@/components/capture/Interactions";
import { ConnectionsTab } from "@/components/relationships/ConnectionsTab";
import { PathList } from "@/components/relationships/PathList";
import { ScoreBlock } from "@/components/relationships/ScoreBlock";
import { personRelationship } from "@/server/relationships";
import { MandateNotes } from "@/components/pack/MandateNotes";
import { getRequestContext } from "@/lib/context";
import { execSearchOn } from "@/lib/packs";
import { localDate } from "@/lib/working-days";
import { ACTION_STATUS_LABELS, ACTION_TYPE_LABELS, CONTACT_TYPE_LABELS, formatDate, SEAT_TYPE_LABELS } from "@/lib/format/labels";
import { can } from "@/lib/permissions";
import { endRoleAction, unmergeAction } from "@/server/record-actions";
import { getPerson, getPersonProvenance } from "@/server/records";
import styles from "../../record.module.css";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await getRequestContext();
  const { id } = await params;
  if (!ctx || !UUID_RE.test(id)) return { title: "Person" };
  const record = await getPerson(ctx.workspace.id, id);
  return { title: record?.person.fullName ?? "Person" };
}

const FIELD_LABELS: Record<string, string> = {
  full_name: "Full name",
  linkedin_url: "LinkedIn profile",
  city: "City",
  country: "Country",
  title: "Title",
  business_email: "Business email",
  ended_on: "End date",
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  apollo: "Apollo",
  sec_8k: "SEC filing",
  press_wire: "Press release",
  google_alert: "News or alert",
  leadership_page: "Leadership page",
  event_site: "Event website",
  newsletter: "Newsletter",
  ai_research: "AI research",
};

const HISTORY_LABELS: Record<string, string> = {
  "person.created": "Record created",
  "person.updated": "Details changed",
  "person.matched": "Matched to an incoming record",
  "person.merged": "Merged into another record",
  "person.unmerged": "Merge reversed",
  "role.created": "Role added",
  "role.ended": "Role ended",
};

export default async function PersonPage({ params, searchParams }: Props) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  const { id } = await params;
  const query = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const record = await getPerson(ctx.workspace.id, id, localDate(new Date(), ctx.workspace.timezone));
  if (!record) notFound();
  const { person, roles, mergedInto, canUnmergeUntil, ownerName, pendingDuplicates, openActions, isOffLimits } = record;
  // Executive search pack elements (BRD 13) are hidden when the pack is off.
  const packOn = execSearchOn(ctx.workspace);
  const placement = packOn ? record.placement : null;
  const canNotes = packOn && can(ctx.role, "mandate_notes.view");
  const rel = await personRelationship(ctx, person.id);
  const canCreateAction = can(ctx.role, "messages.send") && !mergedInto && person.status !== "do_not_contact" && person.isTracked;
  const canPrivacy = can(ctx.role, "compliance.manage") && !mergedInto;
  const tab = query.tab === "record" ? "record" : query.tab === "notes" && canNotes ? "notes" : query.tab === "privacy" && canPrivacy ? "privacy" : query.tab === "interactions" ? "interactions" : query.tab === "connections" ? "connections" : query.tab === "brief" || query.brief ? "brief" : "overview";
  const primary = roles.find((r) => r.isPrimary);
  const editor = can(ctx.role, "records.edit") && !mergedInto;
  const merger = can(ctx.role, "persons.merge");

  return (
    <>
      <Notice notice={query.notice} />
      {mergedInto ? (
        <div className={`card card--accent ${styles.mergedBanner}`}>
          <p>
            This record was merged into <Link href={`/people/${mergedInto.id}`}>{mergedInto.fullName}</Link> and is hidden from lists.
          </p>
          {merger && canUnmergeUntil ? (
            <form action={unmergeAction.bind(null, person.id)}>
              <p className="t-caption t-muted">You can reverse this merge until {formatDate(canUnmergeUntil)}.</p>
              <SubmitButton variant="ghost">Reverse merge</SubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}

      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className="t-display-3">{person.fullName}</h1>
          <p className="t-lede">{primary ? `${primary.title}, ${primary.companyName}` : "No current role"}</p>
          <div>
            {packOn ? person.contactTypes.map((t) => <Chip key={t}>{CONTACT_TYPE_LABELS[t] ?? t}</Chip>) : null}
            {packOn && isOffLimits ? <Chip tone="blocked">Off-limits</Chip> : null}
            {person.isPriority ? <Chip>Tier 1</Chip> : null}
            {placement ? <Chip>Placed</Chip> : null}
            {person.status === "do_not_contact" ? <Chip tone="blocked">Do not contact</Chip> : null}
            {person.status === "no_current_role" ? <Chip>No current role</Chip> : null}
          </div>
        </div>
        {editor || canCreateAction ? (
          <div className={`${styles.headerActions} btn-row`}>
            {canCreateAction ? <Link href={`/people/${person.id}/actions/new`} className="btn btn--ghost">Create action</Link> : null}
            {editor ? <Link href={`/people/${person.id}/interactions/new`} className="btn btn--ghost">Log interaction</Link> : null}
            {editor ? <Link href={`/people/${person.id}/edit`} className="btn btn--ghost">Edit details</Link> : null}
            {editor ? <Link href={`/people/${person.id}/roles/new`} className="btn btn--ghost">Add role</Link> : null}
            {editor && packOn ? <Link href={`/people/${person.id}/placements/new`} className="btn btn--ghost">Record placement</Link> : null}
            {editor && merger ? <Link href={`/people/${person.id}/merge`} className="btn btn--ghost">Merge</Link> : null}
          </div>
        ) : null}
      </div>

      {pendingDuplicates > 0 && can(ctx.role, "queue.work") ? (
        <p className={styles.warnLine}>
          Someone with the same name may be the same person.{" "}
          <Link href="/queue?tab=conflicts">Review in the queue</Link>
        </p>
      ) : null}

      <Tabs
        label="Person sections"
        current={tab}
        tabs={[
          { key: "overview", label: "Overview", href: `/people/${person.id}` },
          { key: "interactions", label: "Interactions", href: `/people/${person.id}?tab=interactions` },
          { key: "connections", label: "Connections", href: `/people/${person.id}?tab=connections` },
          { key: "brief", label: "Brief", href: `/people/${person.id}?tab=brief` },
          { key: "record", label: "Record", href: `/people/${person.id}?tab=record` },
          ...(canNotes ? [{ key: "notes", label: "Notes", href: `/people/${person.id}?tab=notes` }] : []),
          ...(canPrivacy ? [{ key: "privacy", label: "Consent and privacy", href: `/people/${person.id}?tab=privacy` }] : []),
        ]}
      />

      {tab === "overview" ? (
        <div className={styles.columns}>
          <section className="card" aria-labelledby="roles-heading">
            <h2 id="roles-heading" className="t-heading-card">Roles</h2>
            {roles.length === 0 ? <p className="t-caption t-muted">No roles on record.</p> : null}
            <ol className={styles.timeline}>
              {roles.map((r) => (
                <li key={r.id} className={r.status === "ended" ? styles.ended : undefined}>
                  <p className={styles.itemTitle}>
                    {r.title}, <Link href={`/companies/${r.companyId}`}>{r.companyName}</Link>
                    {r.isPrimary ? <span className="t-meta t-muted"> PRIMARY</span> : null}
                  </p>
                  <p className="t-meta t-muted">
                    {SEAT_TYPE_LABELS[r.seatType]} · {r.effectiveOn ? formatDate(r.effectiveOn) : "Start unknown"} to {r.endedOn ? formatDate(r.endedOn) : r.status === "announced" ? "starts later" : "present"}
                  </p>
                  {r.businessEmail ? (
                    <p className="t-caption t-muted">
                      {r.businessEmail}
                      {r.emailStatus === "guessed" ? " (guessed, not used for sending)" : r.emailStatus === "invalid" ? " (bounced)" : ""}
                    </p>
                  ) : null}
                  {editor && r.status !== "ended" ? (
                    <details className={styles.inlineForm}>
                      <summary>End role</summary>
                      <form action={endRoleAction.bind(null, person.id, r.id)} className={styles.inlineGrid}>
                        <label>
                          <span className={styles.miniLabel}>End date</span>
                          <input type="date" name="ended_on" required defaultValue={new Date().toISOString().slice(0, 10)} className={styles.miniInput} />
                        </label>
                        <label className={styles.grow}>
                          <span className={styles.miniLabel}>How do you know?</span>
                          <input type="text" name="source_note" required placeholder="For example: 8-K filed Sep 15" className={styles.miniInput} />
                        </label>
                        <SubmitButton variant="ghost">End role</SubmitButton>
                      </form>
                    </details>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
          <section className="card" aria-labelledby="relationship-heading">
            <h2 id="relationship-heading" className="t-heading-card">Relationship</h2>
            <ScoreBlock firm={rel.firm} byUser={rel.byUser} tz={ctx.workspace.timezone} />
          </section>
          <section className="card" aria-labelledby="paths-heading">
            <h2 id="paths-heading" className="t-heading-card">Best paths</h2>
            <PathList paths={rel.paths} targetId={person.id} targetName={person.fullName} canDraft={can(ctx.role, "messages.send")} empty="No warm path yet: no strong or warm relationship with them or with anyone connected to them." />
          </section>
          <section className="card" aria-labelledby="actions-heading">
            <h2 id="actions-heading" className="t-heading-card">Open actions</h2>
            {openActions.length === 0 ? <p className="t-caption t-muted">No open actions.</p> : null}
            <ul className={styles.plainList}>
              {openActions.map((a) => (
                <li key={a.id}>
                  <Link href={`/actions?owner=all&status=all&id=${a.id}`}>{a.headline ?? ACTION_TYPE_LABELS[a.type]}</Link>
                  <p className="t-meta t-muted">{ACTION_TYPE_LABELS[a.type]} · {ACTION_STATUS_LABELS[a.status]} · due {formatDate(a.dueAt)}{a.blockedReason ? " · blocked" : ""}</p>
                </li>
              ))}
            </ul>
          </section>
          {packOn && record.placements.length ? (
            <section className="card" aria-labelledby="placements-heading">
              <h2 id="placements-heading" className="t-heading-card">Placements</h2>
              <ul className={styles.plainList}>
                {record.placements.map((p) => (
                  <li key={p.id}>
                    <span>{p.roleTitle}, <Link href={`/companies/${p.companyId}`}>{p.companyName}</Link></span>
                    <p className="t-meta t-muted">Placed {formatDate(p.placedOn)}{p.searchReference ? ` · ${p.searchReference}` : ""}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="card" aria-labelledby="facts-heading">
            <h2 id="facts-heading" className="t-heading-card">Details</h2>
            <dl className={styles.readout}>
              <div><dt>Location</dt><dd>{[person.city, person.region, person.country].filter(Boolean).join(", ") || "Not recorded"}</dd></div>
              <div><dt>LinkedIn</dt><dd>{person.linkedinUrl ? <a href={person.linkedinUrl} rel="noreferrer" target="_blank">Profile</a> : "Not recorded"}</dd></div>
              <div><dt>Relationship owner</dt><dd>{ownerName ?? "Not set"}</dd></div>
              {placement ? <div><dt>Placed</dt><dd className="t-meta">{formatDate(placement.placedOn)}, {placement.roleTitle}</dd></div> : null}
            </dl>
          </section>
        </div>
      ) : tab === "brief" ? (
        <BriefTab workspaceId={ctx.workspace.id} personId={person.id} briefId={typeof query.brief === "string" ? query.brief : undefined} tz={ctx.workspace.timezone} canPrepare={can(ctx.role, "messages.send")} />
      ) : tab === "connections" ? (
        <ConnectionsTab personId={person.id} connections={rel.connections} canEdit={editor} />
      ) : tab === "interactions" ? (
        <Interactions ctx={ctx} personId={person.id} />
      ) : tab === "privacy" ? (
        <PrivacyTab workspaceId={ctx.workspace.id} personId={person.id} tz={ctx.workspace.timezone} />
      ) : tab === "notes" ? (
        <MandateNotes actor={{ workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role }} target={{ personId: person.id }} kind="person" id={person.id} tz={ctx.workspace.timezone} />
      ) : (
        <RecordTab workspaceId={ctx.workspace.id} personId={person.id} />
      )}
    </>
  );
}

async function RecordTab({ workspaceId, personId }: { workspaceId: string; personId: string }) {
  const { roleRows, sources, history } = await getPersonProvenance(workspaceId, personId);
  const roleName = new Map(roleRows.map((r) => [r.id, `${r.title}, ${r.companyName}`]));
  const groups = new Map<string, typeof sources>();
  for (const s of sources) {
    const key = `${s.entityType === "person" ? "Person" : (roleName.get(s.entityId) ?? "Role")}|${s.field}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  return (
    <div className={styles.stack}>
      <section className="card" aria-labelledby="sources-heading">
        <h2 id="sources-heading" className="t-heading-card">Fields and their sources</h2>
        <p className="t-caption t-muted">The value marked Shown is on the record. When sources disagree, both are kept until a validator picks one.</p>
        {groups.size === 0 ? <p className="t-caption t-muted">No sources recorded yet.</p> : null}
        <div className={styles.sourceList}>
          {[...groups.entries()].map(([key, rows]) => {
            const [owner, field] = key.split("|") as [string, string];
            return (
              <div key={key} className={styles.sourceGroup}>
                <h3 className={styles.sourceHeading}>
                  {FIELD_LABELS[field] ?? field} <span className="t-caption t-muted">{owner}</span>
                </h3>
                <ul>
                  {rows.map((s) => (
                    <li key={s.id} className={styles.sourceRow}>
                      <span className={styles.sourceValue}>{s.value ?? "Empty"}</span>
                      <span className="t-meta t-muted">
                        {SOURCE_LABELS[s.sourceType] ?? s.sourceType} · {s.confidence.toUpperCase()} · {formatDate(s.capturedAt)}
                      </span>
                      <span>
                        {s.isCurrent ? <Chip>Shown</Chip> : null}
                        {s.inConflict ? <Chip tone="blocked">In conflict</Chip> : null}
                        {s.sourceUrl ? <a href={s.sourceUrl} rel="noreferrer" target="_blank" className="t-caption">Source</a> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
      <section className="card" aria-labelledby="history-heading">
        <h2 id="history-heading" className="t-heading-card">History</h2>
        <ol className={styles.history}>
          {history.map((h, i) => (
            <li key={i}>
              <span>{HISTORY_LABELS[h.action] ?? h.action}</span>
              <span className="t-meta t-muted">
                {formatDate(h.at)} · {h.actorName ?? "System"}
              </span>
              {(h.after as { source_note?: string } | null)?.source_note ? <span className="t-caption t-muted">{(h.after as { source_note: string }).source_note}</span> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
