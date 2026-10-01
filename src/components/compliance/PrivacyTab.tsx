import Link from "next/link";
import formStyles from "@/components/forms/Form.module.css";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Chip } from "@/components/ui/Chip";
import { DataTable } from "@/components/ui/DataTable";
import { APP_BASE_PATH } from "@/config/product";
import { CONSENT_CHANNELS, CONSENT_PURPOSES, CONSENT_STATUSES } from "@/domain/consent";
import { CONSENT_CHANNEL_LABELS, CONSENT_PURPOSE_LABELS, CONSENT_STATUS_LABELS, formatDateIn, SUPPRESSION_REASON_LABELS } from "@/lib/format/labels";
import { erasePersonAction, recordConsentAction, setDoNotContactAction } from "@/server/compliance-actions";
import { getPrivacyTab } from "@/server/compliance";
import styles from "./Compliance.module.css";

/** Consent, do not contact, access and erasure for one person (BRD 18). Data stewards only. */
export async function PrivacyTab({ workspaceId, personId, tz }: { workspaceId: string; personId: string; tz: string }) {
  const data = await getPrivacyTab(workspaceId, personId);
  if (!data) return null;
  const { person, consents, identifiers, preview } = data;
  const dnc = person.status === "do_not_contact";
  const counts = [
    [preview.records, "person record", "person records"],
    [preview.roles, "role", "roles"],
    [preview.interactions, "interaction", "interactions"],
    [preview.signals, "signal", "signals"],
    [preview.actions, "action with its drafts", "actions with their drafts"],
    [preview.briefs, "brief", "briefs"],
    [preview.consents, "consent record", "consent records"],
    [preview.fieldSources, "field source", "field sources"],
  ] as const;

  return (
    <div className={styles.stack}>
      <section className="card" aria-labelledby="dnc-heading">
        <h2 id="dnc-heading" className="t-heading-card">Do not contact</h2>
        <p className="t-caption t-muted">
          {dnc
            ? "On. Nothing can be drafted or sent to this person, and their addresses are on the suppression list."
            : "Off. Turning it on blocks every draft and send to this person, puts their addresses on the suppression list, and dismisses their open actions."}
        </p>
        <form action={setDoNotContactAction.bind(null, person.id, !dnc)} className={formStyles.actions}>
          <SubmitButton variant={dnc ? "ghost" : "primary"}>{dnc ? "Clear do not contact" : "Mark do not contact"}</SubmitButton>
        </form>
        {identifiers.length ? (
          <ul className={styles.plain}>
            {identifiers.map((i) => (
              <li key={i.label}>
                <span className={styles.identifier}>{i.label}</span> {i.reason ? <Chip tone="blocked">{`Suppressed: ${SUPPRESSION_REASON_LABELS[i.reason]}`}</Chip> : <span className="t-caption t-muted">Not suppressed</span>}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="card" aria-labelledby="consent-heading">
        <h2 id="consent-heading" className="t-heading-card">Consent</h2>
        {consents.length === 0 ? <p className="t-caption t-muted">No consent recorded. Outreach to EU, EEA and UK contacts stays blocked until a lawful basis is recorded.</p> : null}
        {consents.length ? (
          <DataTable
            caption="Consent by channel and purpose"
            columns={[{ key: "channel", label: "Channel" }, { key: "purpose", label: "Purpose" }, { key: "status", label: "Status" }, { key: "proof", label: "Proof" }, { key: "recorded", label: "Recorded", numeric: true }]}
            rows={consents.map((c) => ({
              id: c.id,
              cells: {
                channel: CONSENT_CHANNEL_LABELS[c.channel],
                purpose: CONSENT_PURPOSE_LABELS[c.purpose],
                status: `${CONSENT_STATUS_LABELS[c.status]}${c.jurisdiction ? ` (${c.jurisdiction})` : ""}`,
                proof: c.proof ?? "None",
                recorded: `${formatDateIn(c.recordedAt, tz)}${c.recordedBy ? `, ${c.recordedBy}` : c.capturedVia ? `, ${c.capturedVia}` : ""}`,
              },
            }))}
          />
        ) : null}
        <details className={styles.inline}>
          <summary>Record consent</summary>
          <form action={recordConsentAction.bind(null, person.id)} className={formStyles.stack}>
            <div className={formStyles.grid}>
              <label className={formStyles.field}>
                <span className={formStyles.label}>Channel</span>
                <select name="channel" className={formStyles.input} defaultValue="email">
                  {CONSENT_CHANNELS.map((c) => <option key={c} value={c}>{CONSENT_CHANNEL_LABELS[c]}</option>)}
                </select>
              </label>
              <label className={formStyles.field}>
                <span className={formStyles.label}>Purpose</span>
                <select name="purpose" className={formStyles.input} defaultValue="outreach">
                  {CONSENT_PURPOSES.map((p) => <option key={p} value={p}>{CONSENT_PURPOSE_LABELS[p]}</option>)}
                </select>
              </label>
              <label className={formStyles.field}>
                <span className={formStyles.label}>Status</span>
                <select name="status" className={formStyles.input} defaultValue="opted_out">
                  {CONSENT_STATUSES.map((s) => <option key={s} value={s}>{CONSENT_STATUS_LABELS[s]}</option>)}
                </select>
              </label>
              <label className={formStyles.field}>
                <span className={formStyles.label}>Jurisdiction</span>
                <input name="jurisdiction" maxLength={2} placeholder={person.country ?? "US"} defaultValue={person.country ?? ""} className={formStyles.input} />
                <span className={formStyles.help}>Two-letter country code.</span>
              </label>
              <label className={`${formStyles.field} ${formStyles.wide}`}>
                <span className={formStyles.label}>Proof</span>
                <textarea name="proof" rows={3} maxLength={1000} placeholder="For example: unsubscribe reply received 12 Sep 2026, ticket DSR-104" className={`${formStyles.input} ${formStyles.textarea}`} />
                <span className={formStyles.help}>Required for an opt-in: say where and when it was given.</span>
              </label>
            </div>
            <div className={formStyles.actions}>
              <SubmitButton>Record consent</SubmitButton>
            </div>
          </form>
        </details>
      </section>

      <section className="card" aria-labelledby="dsr-heading">
        <h2 id="dsr-heading" className="t-heading-card">Data subject requests</h2>
        <p className="t-caption t-muted">An access request gets everything held about this person as one ZIP, with JSON and CSV. The download is written to the audit log.</p>
        <p>
          <a href={`${APP_BASE_PATH}/api/v1/people/${person.id}/export`} className="btn btn--ghost" download>Export everything held</a>
        </p>
        <details className={styles.danger}>
          <summary>Erase this person</summary>
          <div className={styles.eraseBody}>
            <p>Erasure deletes everything held about {person.fullName} and cannot be undone:</p>
            {preview.alsoErased.length ? (
              <p className="t-caption">
                Also erased, because {preview.alsoErased.length === 1 ? "this record has" : "these records have"} one of the same addresses:{" "}
                {preview.alsoErased.map((p, i) => (
                  <span key={p.id}>{i ? ", " : ""}<Link href={`/people/${p.id}`}>{p.fullName}</Link></span>
                ))}
                .
              </p>
            ) : null}
            <ul className={styles.counts}>
              {counts.filter(([n]) => n > 0).map(([n, one, many]) => <li key={one}>{n} {n === 1 ? one : many}</li>)}
              {preview.crmContacts ? <li>their HubSpot contact, deleted permanently in HubSpot</li> : null}
            </ul>
            <p className="t-caption t-muted">Their {preview.identifiers === 1 ? "address goes" : `${preview.identifiers} addresses go`} on the suppression list as a salted hash, so no import or source can add them again. The audit log keeps a record of the erasure with counts only.</p>
            <form action={erasePersonAction.bind(null, person.id)} className={formStyles.stack}>
              <label className={formStyles.field}>
                <span className={formStyles.label}>To confirm, type their full name: {person.fullName}</span>
                <input name="confirm_name" required autoComplete="off" spellCheck={false} className={formStyles.input} />
              </label>
              <div className={formStyles.actions}>
                <SubmitButton variant="danger">Erase permanently</SubmitButton>
              </div>
            </form>
          </div>
        </details>
      </section>
    </div>
  );
}
