import type { Metadata } from "next";
import Link from "next/link";
import { ActionDrawer } from "@/components/actions/ActionDrawer";
import { DraftEditor } from "@/components/actions/DraftEditor";
import styles from "@/components/actions/Actions.module.css";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar } from "@/components/ui/FilterBar";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { BandPill, PriorityPill, SOURCE_TYPE_LABELS, StatePill } from "@/components/ui/Priority";
import { OPEN_STATUSES } from "@/domain/actions";
import { DISMISS_REASONS, OUTCOMES } from "@/domain/action-flow";
import { ACTION_STATUS_LABELS, ACTION_TYPE_LABELS, CONTACT_TYPE_LABELS, DISMISS_REASON_LABELS, formatDateIn, OUTCOME_LABELS, pageParam } from "@/lib/format/labels";
import { can } from "@/lib/permissions";
import { localDate } from "@/lib/working-days";
import {
  dismissActionAction, markDoneAction, recordLawfulBasisAction, recordOutcomeAction, redraftAction, saveDraftAction, updateActionAction,
} from "@/server/action-actions";
import { getActionDetail, listActions, listOwners, parseActionFilters, type ActionDetail, type ActionFilters } from "@/server/actions";
import { pageContext } from "@/server/guards";

export const metadata: Metadata = { title: "Actions" };

type Params = Record<string, string | string[] | undefined>;

function filterQuery(f: ActionFilters): URLSearchParams {
  const q = new URLSearchParams();
  if (f.owner !== "me") q.set("owner", f.owner);
  if (f.status !== "open") q.set("status", f.status);
  if (f.priority) q.set("priority", String(f.priority));
  if (f.type) q.set("type", f.type);
  if (f.due) q.set("due", f.due);
  return q;
}

const withQuery = (q: URLSearchParams, extra: Record<string, string>) => {
  const next = new URLSearchParams(q);
  for (const [k, v] of Object.entries(extra)) next.set(k, v);
  const s = next.toString();
  return `/actions${s ? `?${s}` : ""}`;
};

/** Word limits from the style guide ("Email: 120 words maximum"), BRD 20.3. */
function wordLimit(styleGuide: unknown, channel: "email" | "linkedin_message"): number {
  const text = String(styleGuide ?? "");
  const m = (channel === "email" ? /Email:\s*(\d+)\s*words/i : /LinkedIn:\s*(\d+)\s*words/i).exec(text);
  return m ? Number(m[1]) : channel === "email" ? 120 : 60;
}

const STEPS = ["Drafted", "Awaiting approval", "Approved", "Sent", "Outcome"];

function currentStep(d: ActionDetail): number {
  const a = d.action;
  if (a.outcome !== "none") return 4;
  if (a.status === "sent" || a.status === "done") return 3;
  if (a.status === "approved") return 2;
  if (a.status === "awaiting_approval") return 1;
  if (a.status === "drafted") return 0;
  return -1;
}

const HISTORY_LABELS: Record<string, string> = {
  "action.created": "Action created",
  "action.signal_merged": "Another change joined this action",
  "draft.generated": "AI draft written",
  "draft.edited": "Draft edited",
  "draft.blocked": "Draft blocked by a pre-action check",
  "action.submitted": "Submitted for approval",
  "action.approved": "Approved",
  "action.sent": "Sent",
  "action.done": "Marked done",
  "action.dismissed": "Dismissed",
  "action.outcome": "Outcome recorded",
  "action.updated": "Action updated",
  "action.escalated": "Escalated: overdue by one working day",
};

export default async function ActionsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const ctx = await pageContext();
  const params = await searchParams;
  const filters = parseActionFilters(params);
  const page = pageParam(params.page);
  const tz = ctx.workspace.timezone;
  const now = new Date();
  const [{ rows, total }, owners] = await Promise.all([listActions(ctx.workspace.id, ctx.user.id, tz, filters, page, 50, now), listOwners(ctx.workspace.id)]);
  const id = typeof params.id === "string" ? params.id : undefined;
  const detail = id ? await getActionDetail(ctx.workspace.id, id, tz, now) : null;
  const q = filterQuery(filters);
  const listHref = withQuery(q, {});
  const scope = filters.owner === "me" ? "yours" : "in this view";
  const date = (d: Date) => formatDateIn(d, tz);

  return (
    <>
      {detail ? null : <Notice notice={params.notice} />}
      <PageHeader title="Actions" lede={`${total} ${filters.status === "open" ? "open" : ""} ${total === 1 ? "action" : "actions"} ${scope}, the most urgent first.`.replace(/\s+/g, " ")} />
      <FilterBar
        path="/actions"
        searchLabel={null}
        values={{ owner: filters.owner === "me" ? undefined : filters.owner, status: filters.status === "open" ? undefined : filters.status, priority: filters.priority ? String(filters.priority) : undefined, type: filters.type, due: filters.due }}
        selects={[
          { name: "owner", label: "Owner", anyLabel: "Me", options: [{ value: "all", label: "Everyone" }, ...owners.filter((o) => o.id !== ctx.user.id).map((o) => ({ value: o.id, label: o.name }))] },
          { name: "status", label: "Status", anyLabel: "Open", options: [...(["awaiting_approval", "approved", "sent", "done", "dismissed"] as const).map((s) => ({ value: s, label: ACTION_STATUS_LABELS[s]! })), { value: "all", label: "All statuses" }] },
          { name: "priority", label: "Priority", options: [1, 2, 3].map((p) => ({ value: String(p), label: `P${p}` })) },
          { name: "type", label: "Type", options: Object.entries(ACTION_TYPE_LABELS).map(([value, label]) => ({ value, label })) },
          { name: "due", label: "Due", options: [{ value: "overdue", label: "Overdue" }, { value: "today", label: "Today or earlier" }, { value: "week", label: "In the next 7 days" }] },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState message="No open actions. Confirmed changes create actions automatically." />
      ) : (
        <ul className={styles.list} aria-label="Actions">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={withQuery(q, { id: r.id })} scroll={false} className={`${styles.card} ${r.id === id ? styles.cardActive : ""}`} data-action-row={r.id} data-person={r.personName ?? ""} aria-current={r.id === id ? "true" : undefined}>
                {r.priority ? <PriorityPill priority={r.priority} /> : <span />}
                <span className={styles.cardMain}>
                  <span className={styles.who}>
                    {r.personName ?? r.companyName ?? "No contact yet"}
                    {r.personName && r.roleTitle ? <span className="t-caption t-muted">, {r.roleTitle}{r.companyName ? ` at ${r.companyName}` : ""}</span> : null}
                  </span>
                  <span className={styles.headline}>{r.headline}</span>
                  <span className={styles.meta}>
                    <span className="t-caption t-muted">{ACTION_TYPE_LABELS[r.type] ?? r.type}</span>
                    {r.personId ? <BandPill band={r.band} /> : null}
                    {r.blocked ? <StatePill tone="blocked">Blocked</StatePill> : null}
                    {r.escalated ? <StatePill tone="warn">Escalated</StatePill> : null}
                    {r.status !== "open" ? <StatePill tone={r.status === "sent" || r.status === "done" ? "ok" : "neutral"}>{ACTION_STATUS_LABELS[r.status] ?? r.status}</StatePill> : null}
                    {r.mergedCount ? <span className="t-meta t-muted">+{r.mergedCount} {r.mergedCount === 1 ? "change" : "changes"}</span> : null}
                    {filters.owner !== "me" ? <span className="t-caption t-muted">Owner: {r.ownerName}</span> : null}
                  </span>
                </span>
                <span className={styles.cardSide}>
                  <span className={`${styles.due} ${r.overdue ? styles.overdue : ""}`}>{r.overdue ? "Overdue " : "Due "}{date(r.dueAt)}</span>
                  <span className={styles.openHint} aria-hidden="true">Open →</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {total > rows.length ? (
        <p className="t-meta t-muted">
          Showing {(page - 1) * 50 + 1} to {(page - 1) * 50 + rows.length} of {total}.{" "}
          {page > 1 ? <Link href={withQuery(q, { page: String(page - 1) })}>Previous</Link> : null} {page * 50 < total ? <Link href={withQuery(q, { page: String(page + 1) })}>Next</Link> : null}
        </p>
      ) : null}
      {id && !detail ? <Notice notice="flow_not_found" /> : null}
      {detail ? <Drawer detail={detail} ctx={ctx} notice={params.notice} closeHref={listHref} back={q.toString()} owners={owners} now={now} /> : null}
    </>
  );
}

function Drawer({ detail: d, ctx, notice, closeHref, back, owners, now }: { detail: ActionDetail; ctx: Awaited<ReturnType<typeof pageContext>>; notice: Params[string]; closeHref: string; back: string; owners: { id: string; name: string }[]; now: Date }) {
  const a = d.action;
  const tz = ctx.workspace.timezone;
  const date = (x: Date) => formatDateIn(x, tz);
  const open = (OPEN_STATUSES as readonly string[]).includes(a.status);
  const canSend = can(ctx.role, "messages.send");
  const canApprove = can(ctx.role, "drafts.approve");
  const canDismiss = can(ctx.role, "actions.dismiss");
  const canBasis = can(ctx.role, "consent.record_basis");
  const blocked = open && d.check?.kind === "blocked" ? d.check : null;
  const cannotContact = d.check?.kind === "no_action";
  const draft = d.draft;
  const formId = `draft-${a.id}`;
  const titleId = `action-title-${a.id}`;
  const step = currentStep(d);
  const isEmail = draft?.channel === "email";
  const draftActions = open && canSend && !blocked && !cannotContact && !!draft;
  const title = d.person?.name ?? d.company?.name ?? "Action";
  const headline = a.headline ?? d.signals[0]?.headline ?? ACTION_TYPE_LABELS[a.type];

  return (
    <ActionDrawer actionId={a.id} closeHref={closeHref} titleId={titleId}>
      <div className={styles.body}>
        <Notice notice={notice} name={d.person?.name} />
        <header className={styles.head}>
          <h2 id={titleId} className={styles.title} tabIndex={-1} data-drawer-title>
            {title}
          </h2>
          {d.currentRole ? <p className="t-caption">{d.currentRole.title}, {d.currentRole.company}</p> : null}
          <div className={styles.meta}>
            {d.person ? <BandPill band={d.position.band?.band ?? null} /> : null}
            {d.person?.contactTypes.map((t) => <Chip key={t}>{CONTACT_TYPE_LABELS[t] ?? t}</Chip>)}
            {d.position.offLimits.length ? <Chip tone="blocked">Off-limits</Chip> : null}
            {d.person?.status === "do_not_contact" ? <Chip tone="blocked">Do not contact</Chip> : null}
            {d.person?.isOffList ? <Chip>Off list</Chip> : null}
          </div>
          <p className="t-caption t-muted">
            {ACTION_TYPE_LABELS[a.type]}. {ACTION_STATUS_LABELS[a.status]}. Owner {d.ownerName}, due {date(a.dueAt)}.
            {d.person ? <> <Link href={`/people/${d.person.id}`}>Open the record</Link></> : null}
          </p>
          {d.escalated ? <StatePill tone="warn">Escalated: overdue by one working day or more</StatePill> : null}
          {a.status === "dismissed" && a.dismissReason ? <StatePill tone="blocked">{`Dismissed: ${DISMISS_REASON_LABELS[a.dismissReason] ?? a.dismissReason}`}</StatePill> : null}
        </header>

        <ol className={styles.steps} aria-label="Status">
          {STEPS.map((s, i) => (
            <li key={s} className={`${styles.step} ${i < step ? styles.stepDone : ""} ${i === step ? styles.stepCurrent : ""}`} aria-current={i === step ? "step" : undefined}>
              {s}
              {i === 4 && a.outcome !== "none" ? `: ${OUTCOME_LABELS[a.outcome]}` : ""}
            </li>
          ))}
        </ol>

        <section className={styles.section} aria-labelledby={`${a.id}-what`}>
          <h3 id={`${a.id}-what`} className={styles.sectionTitle}>What changed</h3>
          <p className={styles.prose}>{headline}</p>
          {d.previousRole ? <p className="t-caption t-muted">Before: {d.previousRole.title}, {d.previousRole.company}{d.previousRole.endedOn ? `, until ${formatDateIn(new Date(`${d.previousRole.endedOn}T12:00:00Z`), tz)}` : ""}</p> : null}
          {d.signals.map((s) => (
            <div key={s.id} className={styles.signal}>
              <div className={styles.meta}>
                <PriorityPill priority={s.priority} />
                <span className="t-caption">{s.headline}</span>
              </div>
              <ul className={styles.sources}>
                {s.sources.map((src, i) => (
                  <li key={i} className="t-caption">
                    {src.url ? <a href={src.url} target="_blank" rel="noreferrer">{src.title ?? src.url}</a> : (src.title ?? "Untitled source")}
                    <span className="t-meta t-muted"> · {SOURCE_TYPE_LABELS[src.sourceType] ?? src.sourceType}{src.publishedAt ? ` · ${date(src.publishedAt)}` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className={styles.section} aria-labelledby={`${a.id}-why`}>
          <h3 id={`${a.id}-why`} className={styles.sectionTitle}>Why it matters</h3>
          <dl className={styles.rows}>
            <div>
              <dt>{a.whyItMatters ?? "Created by hand from the person's record."}</dt>
              <dd />
            </div>
            {d.companySignals.map((s, i) => (
              <div key={i}>
                <dt>{s.headline}</dt>
                <dd>{s.confirmedAt ? date(s.confirmedAt) : ""}</dd>
              </div>
            ))}
          </dl>
        </section>

        {d.person ? (
          <section className={styles.section} aria-labelledby={`${a.id}-pos`}>
            <h3 id={`${a.id}-pos`} className={styles.sectionTitle}>Our position</h3>
            <dl className={styles.rows}>
              <div>
                <dt>Relationship</dt>
                <dd>{d.position.band ? `${d.position.band.band}, ${d.position.band.score} / 100` : "Not scored yet"}</dd>
              </div>
              <div>
                <dt>Last two-way touch</dt>
                <dd>{d.position.lastTwoWay ? `${d.position.lastTwoWay.channel.replace("_", " ")}, ${date(d.position.lastTwoWay.at)}` : "None on record"}</dd>
              </div>
              <div>
                <dt>Contact types</dt>
                <dd>{d.person.contactTypes.map((t) => CONTACT_TYPE_LABELS[t] ?? t).join(", ") || "None"}</dd>
              </div>
              <div>
                <dt>Off-limits</dt>
                <dd>{d.position.offLimits.join("; ") || "None"}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        {d.person ? (
          <section className={styles.section} aria-labelledby={`${a.id}-path`}>
            <h3 id={`${a.id}-path`} className={styles.sectionTitle}>Best path</h3>
            <p className="t-caption t-muted">No introduction path on record yet. Write directly, or ask a colleague who knows them.</p>
          </section>
        ) : null}

        {open && canSend ? (
          <details className={styles.details}>
            <summary>Change the action, owner or due date</summary>
            <div>
              <form action={updateActionAction.bind(null, a.id)} className={styles.inline}>
                <input type="hidden" name="back" value={back} />
                <label className={styles.field}>
                  <span className={styles.label}>Suggested action</span>
                  <select name="type" defaultValue={a.type} className={styles.select}>
                    {Object.entries(ACTION_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Owner</span>
                  <select name="owner" defaultValue={a.ownerUserId} className={styles.select}>
                    {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Due date</span>
                  <input type="date" name="due" defaultValue={localDate(a.dueAt, tz)} className={styles.input} />
                </label>
                <div className={styles.wide}>
                  <SubmitButton variant="ghost" compact>Save changes</SubmitButton>
                </div>
              </form>
            </div>
          </details>
        ) : null}

        {d.person ? (
          <section className={styles.section} aria-labelledby={`${a.id}-draft`}>
            <h3 id={`${a.id}-draft`} className={styles.sectionTitle}>
              Draft{draft ? <span className="t-meta t-muted"> · version {draft.version} of {d.versions} · {draft.author === "ai" ? "AI" : "edited"} · {draft.channel === "email" ? "Email" : "LinkedIn"}</span> : null}
            </h3>
            {cannotContact ? (
              <div className={styles.blocked}>
                <StatePill tone="blocked">Do not contact</StatePill>
                <p>This person must not be contacted, so nothing can be drafted or sent.</p>
              </div>
            ) : blocked ? (
              <div className={styles.blocked} role="note">
                <StatePill tone="blocked">{blocked.reason === "lawful_basis" ? "Consent needed" : blocked.reason === "off_limits" ? "Off-limits" : "Opted out"}</StatePill>
                <p>{blocked.note}{blocked.reason === "lawful_basis" && !canBasis ? " A partner or the data steward can record it." : ""}</p>
                {blocked.reason === "lawful_basis" && canBasis ? (
                  <form action={recordLawfulBasisAction.bind(null, a.id, d.person.id)} className={styles.editor}>
                    <input type="hidden" name="back" value={back} />
                    <label className={styles.field}>
                      <span className={styles.label}>Lawful basis: legitimate interest</span>
                      <textarea name="note" rows={3} className={styles.textarea} required minLength={5} placeholder="For example: existing business relationship since 2024; senior executive contacted in a professional capacity." />
                    </label>
                    <div>
                      <SubmitButton variant="ghost">Record lawful basis</SubmitButton>
                    </div>
                  </form>
                ) : null}
              </div>
            ) : draft ? (
              <DraftEditor
                key={`${draft.id}-${a.status}`}
                formId={formId}
                action={saveDraftAction.bind(null, a.id)}
                back={back}
                channel={draft.channel}
                subject={draft.subject}
                body={draft.body}
                rationale={draft.rationale}
                wordLimit={wordLimit(ctx.workspace.settings.style_guide, draft.channel)}
                issues={(draft.checkIssues as string[]) ?? []}
                readOnly={!draftActions}
              />
            ) : (
              <p className="t-caption t-muted">No draft yet.{open && canSend ? " Use Redraft to write one." : ""}</p>
            )}
            {draft && isEmail && d.recipientEmail ? <p className="t-caption t-muted">To {d.recipientEmail}. Sent from the approving partner&apos;s mailbox ({d.sentToday} of {d.maxPerDay} today).</p> : null}
            {draft?.sentAt ? <StatePill tone="ok">{`Sent ${date(draft.sentAt)}`}</StatePill> : null}
            {draft?.approvedAt && !draft.sentAt ? <p className="t-caption t-muted">Approved by {d.approvedByName ?? "a partner"} on {date(draft.approvedAt)}.</p> : null}
            {draft?.sendError && !draft.sentAt ? <p className={styles.warn}>Last send attempt failed: {draft.sendError}</p> : null}
            {open && canSend && !cannotContact && (!blocked || blocked.reason === "off_limits") ? (
              <details className={styles.details}>
                <summary>Redraft</summary>
                <div>
                  <form action={redraftAction.bind(null, a.id)} className={styles.inline}>
                    <input type="hidden" name="back" value={back} />
                    <label className={`${styles.field} ${styles.wide}`}>
                      <span className={styles.label}>Instruction (optional)</span>
                      <input name="instruction" className={styles.input} maxLength={300} placeholder="For example: shorter, or mention the board appointment" />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Approach</span>
                      <select name="purpose" defaultValue={a.purpose} className={styles.select}>
                        <option value="client">Client</option>
                        <option value="candidate">Candidate</option>
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Channel</span>
                      <select name="channel" defaultValue={draft?.channel ?? ""} className={styles.select}>
                        <option value="">Best available</option>
                        <option value="email">Email</option>
                        <option value="linkedin_message">LinkedIn</option>
                      </select>
                    </label>
                    <div className={styles.wide}>
                      <SubmitButton variant="ghost" compact>Redraft</SubmitButton>
                    </div>
                  </form>
                </div>
              </details>
            ) : null}
          </section>
        ) : null}

        {(a.status === "sent" || a.status === "done") && canSend ? (
          <section className={styles.section} aria-labelledby={`${a.id}-outcome`}>
            <h3 id={`${a.id}-outcome`} className={styles.sectionTitle}>Outcome</h3>
            <form action={recordOutcomeAction.bind(null, a.id)} className={styles.inline}>
              <input type="hidden" name="back" value={back} />
              <label className={styles.field}>
                <span className={styles.label}>What happened</span>
                <select name="outcome" defaultValue={a.outcome === "none" ? "" : a.outcome} className={styles.select} required>
                  <option value="" disabled>Choose</option>
                  {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
                </select>
              </label>
              <div>
                <SubmitButton variant="ghost" compact>Record outcome</SubmitButton>
              </div>
            </form>
          </section>
        ) : null}

        <section className={styles.section} aria-labelledby={`${a.id}-history`}>
          <h3 id={`${a.id}-history`} className={styles.sectionTitle}>History</h3>
          <ul className={styles.history}>
            {d.history.map((h, i) => (
              <li key={i}>
                <span>{HISTORY_LABELS[h.action] ?? h.action}{h.actor ? `, ${h.actor}` : ""}</span>
                <span className="t-meta t-muted">{date(h.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {(open || a.status === "sent") && (canSend || canDismiss) ? (
        <div className={styles.bar} role="group" aria-label="Decision">
          {draftActions && canApprove && isEmail ? <SubmitButton form={formId} name="intent" value="approve_send">Approve and send</SubmitButton> : null}
          {draftActions && canApprove && !isEmail ? <SubmitButton form={formId} name="intent" value="linkedin_sent">Mark sent on LinkedIn</SubmitButton> : null}
          {draftActions && !canApprove && (a.status === "open" || a.status === "drafted") ? <SubmitButton form={formId} name="intent" value="submit">Submit for approval</SubmitButton> : null}
          {draftActions && !canApprove && a.status === "approved" ? <SubmitButton form={formId} name="intent" value={isEmail ? "send" : "linkedin_sent"}>{isEmail ? "Send" : "Mark sent on LinkedIn"}</SubmitButton> : null}
          {draftActions && !canApprove && a.status === "awaiting_approval" ? <span className="t-caption t-muted">Waiting for a partner to approve.</span> : null}
          {draftActions ? <SubmitButton form={formId} name="intent" value="save" variant="ghost">Save draft</SubmitButton> : null}
          {canSend ? (
            <form action={markDoneAction.bind(null, a.id)}>
              <input type="hidden" name="back" value={back} />
              <SubmitButton variant="ghost">Mark done</SubmitButton>
            </form>
          ) : null}
          {open && canDismiss ? (
            <details className={styles.popover}>
              <summary className="btn btn--ghost">Dismiss</summary>
              <form action={dismissActionAction.bind(null, a.id)} className={styles.menu}>
                <input type="hidden" name="back" value={back} />
                <fieldset className={styles.fieldset}>
                  <legend className={styles.label}>Reason</legend>
                  {DISMISS_REASONS.map((r) => (
                    <label key={r} className={styles.radio}>
                      <input type="radio" name="reason" value={r} required />
                      {DISMISS_REASON_LABELS[r]}
                    </label>
                  ))}
                </fieldset>
                <SubmitButton variant="ghost" compact>Dismiss action</SubmitButton>
              </form>
            </details>
          ) : null}
          {now < a.dueAt ? null : <span className={`t-caption ${styles.overdue} ${styles.push}`}>Overdue since {date(a.dueAt)}</span>}
        </div>
      ) : null}
    </ActionDrawer>
  );
}
