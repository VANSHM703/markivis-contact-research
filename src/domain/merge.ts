/**
 * Merge and unmerge people (BRD 7.2). A merge repoints every row about the merged person to the
 * survivor, keeps both field-source trails, and hides the merged row (merged_into_id); nothing is
 * deleted. Rows that would duplicate one the survivor already has stay with the hidden person.
 * The audit entry records exactly what moved, and unmerge reverses it within 90 days.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { auditLog, calendarEvents, connections, persons, queueItems, roles } from "@/db/schema";
import { audit } from "@/lib/audit";
import { recomputePrimaryRole, refreshPersonStatus, type Actor } from "./records";

export const UNMERGE_WINDOW_DAYS = 90;

/** Tables whose person_id column moves on merge, with the columns that make a row a duplicate. */
const PERSON_TABLES: { table: string; column: string; uniqueWith?: string[] }[] = [
  { table: "roles", column: "person_id", uniqueWith: ["company_id", "title_normalised", "effective_on"] },
  { table: "interactions", column: "person_id" },
  { table: "signals", column: "person_id" },
  { table: "actions", column: "person_id" },
  { table: "placements", column: "person_id" },
  { table: "mandate_notes", column: "person_id" },
  { table: "consents", column: "person_id", uniqueWith: ["channel", "purpose"] },
  { table: "person_interests", column: "person_id", uniqueWith: ["topic", "source"] },
  { table: "briefs", column: "person_id" },
  { table: "relationship_scores", column: "person_id", uniqueWith: ["user_id"] },
  { table: "sponsor_links", column: "deal_partner_person_id" },
];

const SURVIVOR_FILL = ["preferred_name", "linkedin_url", "city", "region", "country"] as const;

interface MergeRecord {
  survivor_id: string;
  moved: Record<string, string[]>;
  field_sources: string[];
  merged_children: string[];
  calendar: { id: string; person_ids: string[] }[];
  connections: { id: string; person_a_id: string; person_b_id: string }[];
  survivor_before: Record<string, unknown>;
  merged_linkedin_url: string | null;
}

export class MergeError extends Error {}

export async function mergePersons(tx: Tx, actor: Actor, survivorId: string, mergedId: string): Promise<void> {
  if (survivorId === mergedId) throw new MergeError("Choose two different people to merge.");
  const rows = await tx.select().from(persons).where(inArray(persons.id, [survivorId, mergedId]));
  const survivor = rows.find((p) => p.id === survivorId);
  const merged = rows.find((p) => p.id === mergedId);
  if (!survivor || !merged) throw new MergeError("Person not found.");
  if (survivor.mergedIntoId || merged.mergedIntoId) throw new MergeError("One of these people has already been merged.");

  const record: MergeRecord = {
    survivor_id: survivorId,
    moved: {},
    field_sources: [],
    merged_children: [],
    calendar: [],
    connections: [],
    survivor_before: {},
    merged_linkedin_url: merged.linkedinUrl,
  };

  // At most one primary role per person: the survivor's primary is recomputed after the move.
  await tx.update(roles).set({ isPrimary: false }).where(eq(roles.personId, mergedId));

  for (const { table, column, uniqueWith } of PERSON_TABLES) {
    const clash = uniqueWith
      ? sql` and not exists (select 1 from ${sql.identifier("dmi")}.${sql.identifier(table)} s where s.${sql.identifier(column)} = ${survivorId} and ${sql.join(
          uniqueWith.map((c) => sql`s.${sql.identifier(c)} is not distinct from t.${sql.identifier(c)}`),
          sql` and `,
        )})`
      : sql``;
    const result = await tx.execute<{ id: string }>(
      sql`update ${sql.identifier("dmi")}.${sql.identifier(table)} t set ${sql.identifier(column)} = ${survivorId}
          where t.${sql.identifier(column)} = ${mergedId}${clash} returning t.id`,
    );
    if (result.rows.length > 0) record.moved[table] = result.rows.map((r) => r.id);
  }

  const fs = await tx.execute<{ id: string }>(
    sql`update dmi.field_sources set entity_id = ${survivorId} where entity_type = 'person' and entity_id = ${mergedId} returning id`,
  );
  record.field_sources = fs.rows.map((r) => r.id);

  const children = await tx.update(persons).set({ mergedIntoId: survivorId }).where(eq(persons.mergedIntoId, mergedId)).returning({ id: persons.id });
  record.merged_children = children.map((c) => c.id);

  const events = await tx.select({ id: calendarEvents.id, personIds: calendarEvents.personIds }).from(calendarEvents).where(sql`${mergedId} = any(${calendarEvents.personIds})`);
  for (const event of events) {
    record.calendar.push({ id: event.id, person_ids: event.personIds });
    const next = Array.from(new Set(event.personIds.map((p) => (p === mergedId ? survivorId : p))));
    await tx.update(calendarEvents).set({ personIds: next }).where(eq(calendarEvents.id, event.id));
  }

  // Connections are stored with person_a_id < person_b_id; re-order after repointing, and leave
  // behind any that would connect the survivor to themself or duplicate an existing tie.
  const ties = await tx.select().from(connections).where(sql`${connections.personAId} = ${mergedId} or ${connections.personBId} = ${mergedId}`);
  for (const tie of ties) {
    const other = tie.personAId === mergedId ? tie.personBId : tie.personAId;
    if (other === survivorId) continue;
    const [a, b] = [survivorId, other].sort() as [string, string];
    const [dupe] = await tx
      .select({ id: connections.id })
      .from(connections)
      .where(and(eq(connections.personAId, a), eq(connections.personBId, b), eq(connections.type, tie.type), sql`${connections.companyId} is not distinct from ${tie.companyId}`))
      .limit(1);
    if (dupe) continue;
    record.connections.push({ id: tie.id, person_a_id: tie.personAId, person_b_id: tie.personBId });
    await tx.update(connections).set({ personAId: a, personBId: b }).where(eq(connections.id, tie.id));
  }

  // Fill the survivor's empty fields from the merged person, and combine flags.
  const fill: Partial<typeof persons.$inferInsert> = {};
  const camel = { preferred_name: "preferredName", linkedin_url: "linkedinUrl", city: "city", region: "region", country: "country" } as const;
  for (const column of SURVIVOR_FILL) {
    const key = camel[column];
    if (!survivor[key] && merged[key]) {
      record.survivor_before[key] = survivor[key];
      (fill as Record<string, unknown>)[key] = merged[key];
    }
  }
  const types = Array.from(new Set([...survivor.contactTypes, ...merged.contactTypes]));
  if (types.length !== survivor.contactTypes.length) {
    record.survivor_before.contactTypes = survivor.contactTypes;
    fill.contactTypes = types;
  }
  if (merged.isPriority && !survivor.isPriority) {
    record.survivor_before.isPriority = false;
    fill.isPriority = true;
  }

  // The LinkedIn URL is unique per workspace, so it leaves the merged row before the survivor takes it.
  await tx.update(persons).set({ mergedIntoId: survivorId, linkedinUrl: fill.linkedinUrl ? null : merged.linkedinUrl }).where(eq(persons.id, mergedId));
  if (Object.keys(fill).length > 0) await tx.update(persons).set(fill).where(eq(persons.id, survivorId));

  await recomputePrimaryRole(tx, survivorId);
  await refreshPersonStatus(tx, survivorId);

  // Resolve any pending possible-duplicate item about this pair.
  await tx
    .update(queueItems)
    .set({ status: "resolved", resolvedBy: actor.userId, resolvedAt: new Date() })
    .where(and(eq(queueItems.kind, "possible_duplicate"), eq(queueItems.status, "pending"), sql`${queueItems.payload}->'person_ids' @> ${JSON.stringify([survivorId, mergedId])}::jsonb`));

  await audit(tx, {
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    actorKind: actor.kind ?? "user",
    action: "person.merged",
    entityType: "person",
    entityId: mergedId,
    before: { survivor: record.survivor_before, merged_linkedin_url: record.merged_linkedin_url },
    after: record,
  });
}

/** The merge that can still be reversed for this person, or null. */
export async function reversibleMerge(tx: Tx, mergedId: string, now = new Date()) {
  const since = new Date(now.getTime() - UNMERGE_WINDOW_DAYS * 86_400_000);
  const [entry] = await tx
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, "person"), eq(auditLog.entityId, mergedId), inArray(auditLog.action, ["person.merged", "person.unmerged"]), gte(auditLog.at, since)))
    .orderBy(desc(auditLog.at))
    .limit(1);
  if (!entry || entry.action !== "person.merged") return null;
  const [person] = await tx.select({ mergedIntoId: persons.mergedIntoId }).from(persons).where(eq(persons.id, mergedId)).limit(1);
  const record = entry.after as MergeRecord;
  if (!person || person.mergedIntoId !== record.survivor_id) return null;
  return { at: entry.at, record };
}

export async function unmergePerson(tx: Tx, actor: Actor, mergedId: string): Promise<void> {
  const merge = await reversibleMerge(tx, mergedId);
  if (!merge) throw new MergeError(`This merge can no longer be reversed. Merges can be reversed for ${UNMERGE_WINDOW_DAYS} days.`);
  const { record } = merge;
  const survivorId = record.survivor_id;

  if (record.moved.roles?.length) await tx.update(roles).set({ isPrimary: false }).where(inArray(roles.id, record.moved.roles));

  for (const { table, column } of PERSON_TABLES) {
    const ids = record.moved[table];
    if (!ids?.length) continue;
    await tx.execute(
      sql`update ${sql.identifier("dmi")}.${sql.identifier(table)} set ${sql.identifier(column)} = ${mergedId}
          where id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`,
    );
  }
  if (record.field_sources.length) {
    await tx.execute(sql`update dmi.field_sources set entity_id = ${mergedId} where id in (${sql.join(record.field_sources.map((i) => sql`${i}::uuid`), sql`, `)})`);
  }
  if (record.merged_children.length) await tx.update(persons).set({ mergedIntoId: mergedId }).where(inArray(persons.id, record.merged_children));
  for (const event of record.calendar) await tx.update(calendarEvents).set({ personIds: event.person_ids }).where(eq(calendarEvents.id, event.id));
  for (const tie of record.connections) await tx.update(connections).set({ personAId: tie.person_a_id, personBId: tie.person_b_id }).where(eq(connections.id, tie.id));

  // Restore the survivor's own fields first, so the LinkedIn URL is free for the merged person again.
  if (Object.keys(record.survivor_before).length > 0) await tx.update(persons).set(record.survivor_before as Partial<typeof persons.$inferInsert>).where(eq(persons.id, survivorId));
  await tx.update(persons).set({ mergedIntoId: null, linkedinUrl: record.merged_linkedin_url }).where(eq(persons.id, mergedId));

  for (const id of [survivorId, mergedId]) {
    await recomputePrimaryRole(tx, id);
    await refreshPersonStatus(tx, id);
  }
  await audit(tx, {
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    actorKind: actor.kind ?? "user",
    action: "person.unmerged",
    entityType: "person",
    entityId: mergedId,
    after: { survivor_id: survivorId },
  });
}
