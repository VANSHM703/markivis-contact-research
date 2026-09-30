/**
 * Confidential mandate notes (BRD 13, 6.5): on a person or a company, readable only by the
 * partner. Every read and every export is written to the audit log. Notes are never sent to the
 * AI: no drafting, brief or research input reads this table.
 */
import { desc, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { mandateNotes, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";
import type { WorkspaceRole } from "@/config/navigation";

interface Actor {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

export type NoteTarget = { personId: string } | { companyId: string };

const targetWhere = (t: NoteTarget) => ("personId" in t ? eq(mandateNotes.personId, t.personId) : eq(mandateNotes.companyId, t.companyId));
const entity = (t: NoteTarget) => ("personId" in t ? { entityType: "person", entityId: t.personId } : { entityType: "company", entityId: t.companyId });

export class NoteTooShortError extends Error {}

/** Reads the notes on a person or company, and records the read. */
export async function readMandateNotes(tx: Tx, actor: Actor, target: NoteTarget) {
  assertCan(actor.role, "mandate_notes.view");
  const rows = await tx
    .select({ id: mandateNotes.id, body: mandateNotes.body, createdAt: mandateNotes.createdAt, author: users.name })
    .from(mandateNotes)
    .innerJoin(users, eq(users.id, mandateNotes.createdBy))
    .where(targetWhere(target))
    .orderBy(desc(mandateNotes.createdAt));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "mandate_notes.viewed", ...entity(target), after: { count: rows.length } });
  return rows;
}

export async function addMandateNote(tx: Tx, actor: Actor, target: NoteTarget, body: string): Promise<string> {
  assertCan(actor.role, "mandate_notes.view");
  const text = body.replace(/\r\n/g, "\n").trim();
  if (text.length < 2 || text.length > 5000) throw new NoteTooShortError("A note is 2 to 5,000 characters.");
  const [row] = await tx
    .insert(mandateNotes)
    .values({ workspaceId: actor.workspaceId, ...("personId" in target ? { personId: target.personId } : { companyId: target.companyId }), body: text, createdBy: actor.userId })
    .returning({ id: mandateNotes.id });
  // The audit entry records that a note was written, never its text.
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "mandate_note.created", ...entity(target), after: { note_id: row!.id, length: text.length } });
  return row!.id;
}
