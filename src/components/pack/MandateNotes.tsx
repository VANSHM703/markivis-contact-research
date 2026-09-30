/**
 * Confidential mandate notes (BRD 13): partner only. Rendering this component reads the notes,
 * and that read is written to the audit log. Notes never reach the AI.
 */
import { withWorkspace } from "@/db/client";
import { readMandateNotes, type NoteTarget } from "@/domain/mandate-notes";
import type { WorkspaceRole } from "@/config/navigation";
import { formatDateIn } from "@/lib/format/labels";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { addMandateNoteAction } from "@/server/pack-actions";
import formStyles from "@/components/forms/Form.module.css";
import styles from "@/app/(app)/record.module.css";

export async function MandateNotes({ actor, target, kind, id, tz }: { actor: { workspaceId: string; userId: string; role: WorkspaceRole }; target: NoteTarget; kind: "person" | "company"; id: string; tz: string }) {
  const notes = await withWorkspace(actor.workspaceId, (tx) => readMandateNotes(tx, actor, target));
  return (
    <section className="card" aria-labelledby={`notes-${id}`}>
      <h2 id={`notes-${id}`} className="t-heading-card">Confidential mandate notes</h2>
      <p className="t-caption t-muted">Only partners can read these. Every view is recorded in the audit log, and notes are never sent to the AI.</p>
      <form action={addMandateNoteAction.bind(null, kind, id)} className={formStyles.stack}>
        <label className={formStyles.field}>
          <span className={formStyles.label}>New note</span>
          <textarea name="body" required minLength={2} maxLength={5000} rows={4} className={`${formStyles.input} ${formStyles.textarea}`} />
        </label>
        <div className={formStyles.actions}>
          <SubmitButton variant="ghost">Add note</SubmitButton>
        </div>
      </form>
      {notes.length === 0 ? <p className="t-caption t-muted">No notes yet.</p> : null}
      <ul className={styles.plainList}>
        {notes.map((n) => (
          <li key={n.id}>
            <p className={styles.noteBody}>{n.body}</p>
            <p className="t-meta t-muted">{n.author} · {formatDateIn(n.createdAt, tz)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
