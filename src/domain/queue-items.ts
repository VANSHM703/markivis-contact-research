/**
 * Non-signal queue items (BRD 10.4): data conflicts (pick a value) and possible duplicates
 * (merge, or keep separate). Signals join the same queue in M4.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { companies, fieldSources, persons, queueItems, roles } from "@/db/schema";
import { audit } from "@/lib/audit";
import { normaliseCompanyName, normaliseName } from "@/lib/normalise";
import { mergePersons } from "./merge";
import type { Actor } from "./records";

export interface ConflictPayload {
  entity_type: "person" | "company" | "role";
  entity_id: string;
  field: string;
  field_source_ids: string[];
  values: (string | null)[];
}

export interface DuplicatePayload {
  person_ids: string[];
  reason: string;
  import_batch_id?: string | null;
}

/** Which record column each provenance field controls. */
const FIELD_COLUMNS: Record<ConflictPayload["entity_type"], Record<string, string>> = {
  person: { full_name: "fullName", linkedin_url: "linkedinUrl", city: "city", country: "country" },
  company: { name: "name", domain: "domain", sec_cik: "secCik" },
  role: { title: "title", business_email: "businessEmail", ended_on: "endedOn" },
};

export class QueueItemError extends Error {}

async function pendingItem(tx: Tx, itemId: string) {
  const [item] = await tx.select().from(queueItems).where(and(eq(queueItems.id, itemId), eq(queueItems.status, "pending"))).limit(1);
  if (!item) throw new QueueItemError("This item has already been resolved.");
  return item;
}

async function resolve(tx: Tx, actor: Actor, itemId: string, decision: Record<string, unknown>) {
  await tx.update(queueItems).set({ status: "resolved", resolvedBy: actor.userId, resolvedAt: new Date() }).where(eq(queueItems.id, itemId));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "queue_item.resolved", entityType: "queue_item", entityId: itemId, after: decision });
}

/** Resolves a data conflict by choosing the field source whose value the record should show. */
export async function resolveConflict(tx: Tx, actor: Actor, itemId: string, chosenFieldSourceId: string): Promise<void> {
  const item = await pendingItem(tx, itemId);
  if (item.kind !== "data_conflict") throw new QueueItemError("This item is not a data conflict.");
  const payload = item.payload as ConflictPayload;
  if (!payload.field_source_ids.includes(chosenFieldSourceId)) throw new QueueItemError("Choose one of the conflicting values.");

  const [chosen] = await tx.select().from(fieldSources).where(eq(fieldSources.id, chosenFieldSourceId)).limit(1);
  if (!chosen) throw new QueueItemError("That value no longer exists.");
  await tx.update(fieldSources).set({ isCurrent: false, inConflict: false }).where(inArray(fieldSources.id, payload.field_source_ids));
  await tx.update(fieldSources).set({ isCurrent: true, inConflict: false, lastCheckedAt: new Date() }).where(eq(fieldSources.id, chosen.id));

  const column = FIELD_COLUMNS[payload.entity_type][payload.field];
  if (column) {
    const value = chosen.value;
    if (payload.entity_type === "person") {
      const set: Record<string, unknown> = { [column]: value };
      if (column === "fullName" && value) set.nameNormalised = normaliseName(value);
      await tx.update(persons).set(set).where(eq(persons.id, payload.entity_id));
    } else if (payload.entity_type === "company") {
      const set: Record<string, unknown> = { [column]: value };
      if (column === "name" && value) set.nameNormalised = normaliseCompanyName(value);
      await tx.update(companies).set(set).where(eq(companies.id, payload.entity_id));
    } else {
      await tx.update(roles).set({ [column]: value }).where(eq(roles.id, payload.entity_id));
    }
  }
  await resolve(tx, actor, itemId, { decision: "picked_value", field: payload.field, value: chosen.value, source_type: chosen.sourceType });
}

/** Resolves a possible duplicate: merge into the chosen survivor, or keep the records separate. */
export async function resolveDuplicate(tx: Tx, actor: Actor, itemId: string, decision: { merge: true; survivorId: string } | { merge: false }): Promise<void> {
  const item = await pendingItem(tx, itemId);
  if (item.kind !== "possible_duplicate") throw new QueueItemError("This item is not a possible duplicate.");
  const payload = item.payload as DuplicatePayload;
  if (!decision.merge) {
    await resolve(tx, actor, itemId, { decision: "kept_separate", person_ids: payload.person_ids });
    return;
  }
  if (!payload.person_ids.includes(decision.survivorId)) throw new QueueItemError("Choose which record to keep.");
  for (const other of payload.person_ids.filter((id) => id !== decision.survivorId)) {
    const [row] = await tx.select({ mergedIntoId: persons.mergedIntoId }).from(persons).where(eq(persons.id, other)).limit(1);
    if (row && !row.mergedIntoId) await mergePersons(tx, actor, decision.survivorId, other);
  }
  // mergePersons resolves the item when the pair matches; make sure it is closed either way.
  const [still] = await tx.select({ status: queueItems.status }).from(queueItems).where(eq(queueItems.id, itemId)).limit(1);
  if (still?.status === "pending") await resolve(tx, actor, itemId, { decision: "merged", survivor_id: decision.survivorId });
}
