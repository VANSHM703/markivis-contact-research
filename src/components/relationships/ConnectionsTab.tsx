/** The Connections tab (BRD 16.2): derived and manual connections, and adding one by hand. */
import Link from "next/link";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Chip } from "@/components/ui/Chip";
import { CONNECTION_LABELS } from "@/domain/connections";
import { formatDate } from "@/lib/format/labels";
import { addConnectionAction, removeConnectionAction } from "@/server/relationship-actions";
import { AddConnectionForm } from "./AddConnectionForm";
import styles from "./Relationships.module.css";

type Connection = { id: string; otherId: string; otherName: string; type: string; weight: number; companyName: string | null; periodStart: string | null; periodEnd: string | null; derived: boolean; note: string | null };

export function ConnectionsTab({ personId, connections, canEdit }: { personId: string; connections: Connection[]; canEdit: boolean }) {
  const sorted = [...connections].sort((a, b) => b.weight - a.weight || a.otherName.localeCompare(b.otherName));
  return (
    <section className="card" aria-labelledby="connections-heading">
      <h2 id="connections-heading" className="t-heading-card">Connections <span className="t-meta t-muted">{connections.length}</span></h2>
      <p className="t-caption t-muted">Derived every night from shared boards and overlapping executive roles, plus any added by hand. Connections feed the warm path finder.</p>
      {sorted.length === 0 ? <p className="t-caption t-muted">No connections yet.</p> : null}
      <ul className={styles.connections}>
        {sorted.map((c) => (
          <li key={c.id}>
            <span>
              <Link href={`/people/${c.otherId}`}>{c.otherName}</Link>
              <span className="t-caption t-muted">
                {c.companyName ? ` · ${c.companyName}` : ""}
                {c.periodStart ? ` · ${formatDate(c.periodStart)} to ${c.periodEnd ? formatDate(c.periodEnd) : "present"}` : ""}
                {c.note ? ` · ${c.note}` : ""}
              </span>
            </span>
            <span className="btn-row">
              <Chip>{CONNECTION_LABELS[c.type] ?? c.type}</Chip>
              <span className="t-meta">{c.weight.toFixed(2)}</span>
              <span className="t-caption t-muted">{c.derived ? "From roles" : "Added by hand"}</span>
              {canEdit && !c.derived ? (
                <form action={removeConnectionAction.bind(null, personId, c.id)}>
                  <SubmitButton variant="ghost" compact>Remove</SubmitButton>
                </form>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <>
          <h3 className="t-heading-card">Add a connection</h3>
          <AddConnectionForm action={addConnectionAction.bind(null, personId)} />
        </>
      ) : null}
    </section>
  );
}
