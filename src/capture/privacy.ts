/**
 * Privacy on captured activity (BRD 11.3, 5.4): the partner marks a thread or a contact private.
 * Private interactions still count toward scores; their subject and summary are shown only to the
 * partner. Other roles with subject access see that an interaction happened, not what it was.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { interactions, privacyMarks } from "@/db/schema";
import { audit } from "@/lib/audit";
import { assertCan, can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/config/navigation";

interface Actor {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

/** Whether a role may read an interaction's subject and summary. */
export function canSeeDetail(role: WorkspaceRole, isPrivate: boolean): boolean {
  if (!can(role, "interactions.view_subject")) return false;
  return !isPrivate || can(role, "privacy.mark_private");
}

async function mark(tx: Tx, actor: Actor, kind: "thread" | "person", key: string, on: boolean) {
  if (on) await tx.insert(privacyMarks).values({ workspaceId: actor.workspaceId, kind, key, createdBy: actor.userId }).onConflictDoNothing();
  else await tx.delete(privacyMarks).where(and(eq(privacyMarks.kind, kind), eq(privacyMarks.key, key)));
}

/** Recomputes is_private for the given interactions from the current marks. */
async function recompute(tx: Tx, where: ReturnType<typeof eq>) {
  await tx
    .update(interactions)
    .set({
      isPrivate: sql`exists (select 1 from dmi.privacy_marks m where (m.kind = 'thread' and m.key = ${interactions.threadKey}) or (m.kind = 'person' and m.key = ${interactions.personId}::text))
        or (${interactions.capturedBy} = 'manual' and ${interactions.isPrivate} and ${interactions.threadKey} is null)`,
    })
    .where(where);
}

export async function setThreadPrivate(tx: Tx, actor: Actor, threadKey: string, on: boolean): Promise<void> {
  assertCan(actor.role, "privacy.mark_private");
  await mark(tx, actor, "thread", threadKey, on);
  await recompute(tx, eq(interactions.threadKey, threadKey));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: on ? "privacy.thread_marked" : "privacy.thread_unmarked", entityType: "thread", after: { thread_key: threadKey } });
}

export async function setPersonPrivate(tx: Tx, actor: Actor, personId: string, on: boolean): Promise<void> {
  assertCan(actor.role, "privacy.mark_private");
  await mark(tx, actor, "person", personId, on);
  await recompute(tx, eq(interactions.personId, personId));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: on ? "privacy.person_marked" : "privacy.person_unmarked", entityType: "person", entityId: personId });
}

export async function isPersonPrivate(tx: Tx, personId: string): Promise<boolean> {
  const [row] = await tx.select({ id: privacyMarks.id }).from(privacyMarks).where(and(eq(privacyMarks.kind, "person"), eq(privacyMarks.key, personId))).limit(1);
  return !!row;
}

export async function privateThreads(tx: Tx, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await tx.select({ key: privacyMarks.key }).from(privacyMarks).where(and(eq(privacyMarks.kind, "thread"), inArray(privacyMarks.key, keys)));
  return new Set(rows.map((r) => r.key));
}
