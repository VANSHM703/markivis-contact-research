/**
 * Data subject erasure (BRD 18.2, acceptance scenario 22). One run, in one transaction, removes
 * everything held about a person:
 *
 *   - the person, every record merged into them and any other record with one of their email
 *     addresses or LinkedIn URLs, and through foreign keys their roles,
 *     interactions, signals and signal sources, actions and drafts, briefs, consents, scores,
 *     connections, interests, placements and mandate notes;
 *   - what is not tied to them by a foreign key: field sources, raw items that concern only them,
 *     their place in calendar events, queue items, privacy marks, notifications that name them,
 *     and their rows in import files;
 *   - the personal data in audit entries about any of those rows, through dmi.redact_audit (the
 *     log stays append-only for the application; who did what, and when, is kept);
 *
 * then writes a suppression hash for each known email and LinkedIn URL, so no import or adapter
 * can add them again, and one audit entry that holds counts only. Their CRM contacts are marked
 * in the same transaction and deleted in the CRM straight after it (src/crm/sync.ts); a CRM that
 * cannot be reached is retried on every sync run until the delete goes through.
 */
import { sql, type SQL } from "drizzle-orm";
import { withWorkspace, type Tx } from "@/db/client";
import { deleteErasedContacts } from "@/crm/sync";
import type { HttpClient } from "@/ingest/http";
import { audit } from "@/lib/audit";
import { canonicalLinkedinUrl, normaliseEmail } from "@/lib/normalise";
import type { Actor } from "./records";
import { addSuppression } from "./suppression";

export class ErasureError extends Error {}

type Ids = string[];

const list = (ids: Ids) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
const inIds = (column: string, ids: Ids): SQL => (ids.length ? sql`${sql.raw(column)} in (${list(ids)})` : sql`false`);
const texts = (values: string[]) => sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
/** A LIKE pattern that matches the value anywhere, with its wildcards escaped. */
const containing = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
/** A case-insensitive regular expression for the name as whole words. */
const wholeWords = (name: string) => `\\m${name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\M`;
const likeAny = (expression: SQL, patterns: string[]): SQL => (patterns.length ? sql`${expression} ilike any (${texts(patterns)})` : sql`false`);
const matchAny = (expression: SQL, patterns: string[]): SQL => (patterns.length ? sql`${expression} ~* any (${texts(patterns)})` : sql`false`);

async function column(tx: Tx, query: SQL): Promise<Ids> {
  return (await tx.execute<{ id: string }>(query)).rows.map((r) => r.id);
}

/** Everything the erasure touches, gathered before anything changes. */
interface Gathered {
  rootId: string;
  family: Ids;
  /** Other records (not merged into this one) that share an email or LinkedIn URL. */
  alsoErased: { id: string; fullName: string }[];
  names: string[];
  emails: string[];
  linkedinUrls: string[];
  /** Rows that go with the person through foreign keys, by table. */
  cascaded: Record<string, Ids>;
  fieldSources: Ids;
  rawItems: Ids;
  queueItems: Ids;
  privacyMarks: Ids;
  notifications: Ids;
  crmPersonLinks: Ids;
  crmOtherLinks: Ids;
  importBatches: Ids;
  calendar: { id: string; personIds: string[]; attendeeEmails: string[] }[];
}

type PersonRow = { id: string; full_name: string; linkedin_url: string | null; is_root: boolean };

/** A record's merge family: up to the surviving record, then every record merged into it. */
async function familyRows(tx: Tx, personId: string): Promise<PersonRow[]> {
  return (
    await tx.execute<PersonRow>(sql`
      with recursive up(id, merged_into_id) as (
        select id, merged_into_id from dmi.persons where id = ${personId}::uuid
        union
        select p.id, p.merged_into_id from dmi.persons p join up on p.id = up.merged_into_id
      ), down(id) as (
        select id from up where merged_into_id is null
        union
        select p.id from dmi.persons p join down on p.merged_into_id = down.id
      )
      select p.id, p.full_name, p.linkedin_url, p.merged_into_id is null as is_root
      from dmi.persons p where p.id in (select id from down)
      order by (p.merged_into_id is null) desc`)
  ).rows;
}

/** Every email and LinkedIn URL known for the records: current, from sources, and from merges. */
async function identifiersOf(tx: Tx, people: PersonRow[]) {
  const family = people.map((p) => p.id);
  const roleRows = (await tx.execute<{ id: string; business_email: string | null }>(sql`select id, business_email from dmi.roles where ${inIds("person_id", family)}`)).rows;
  const roleIds = roleRows.map((r) => r.id);
  const sources = (
    await tx.execute<{ id: string; field: string; value: string | null }>(sql`
      select id, field, value from dmi.field_sources
      where (entity_type = 'person' and ${inIds("entity_id", family)}) or (entity_type = 'role' and ${inIds("entity_id", roleIds)})`)
  ).rows;
  // LinkedIn URLs a merge moved between records are kept in the merge's audit entry.
  const mergedUrls = (
    await tx.execute<{ url: string | null }>(sql`
      select before->>'merged_linkedin_url' as url from dmi.audit_log where action = 'person.merged' and ${inIds("entity_id", family)}
      union select after->'survivor_before'->>'linkedinUrl' from dmi.audit_log where action = 'person.merged' and ${inIds("entity_id", family)}`)
  ).rows.map((r) => r.url);
  const emails = uniqueBy([...roleRows.map((r) => r.business_email), ...sources.filter((s) => s.field === "business_email").map((s) => s.value)], (v) => normaliseEmail(v));
  const linkedinUrls = uniqueBy([...people.map((p) => p.linkedin_url), ...sources.filter((s) => s.field === "linkedin_url").map((s) => s.value), ...mergedUrls], (v) => canonicalLinkedinUrl(v));
  return { roleIds, sources, emails, linkedinUrls };
}

async function gather(tx: Tx, personId: string): Promise<Gathered> {
  const first = await familyRows(tx, personId);
  if (first.length === 0) throw new ErasureError("Person not found.");
  const rootId = first.find((p) => p.is_root)?.id ?? first[0]!.id;

  // Another record with one of their addresses is the same person, even when nobody merged the
  // two: it is erased with them, and the confirmation names it.
  const people = new Map(first.map((p) => [p.id, p]));
  let known = await identifiersOf(tx, first);
  for (let round = 0; round < 5; round++) {
    const ids = Array.from(people.keys());
    const emails = known.emails.map((e) => normaliseEmail(e)!).filter(Boolean);
    const urls = known.linkedinUrls.map((u) => canonicalLinkedinUrl(u)!).filter(Boolean);
    const others = await column(
      tx,
      sql`select distinct p.id from dmi.persons p left join dmi.roles r on r.person_id = p.id
          where not ${inIds("p.id", ids)} and (lower(r.business_email) = any (${texts(emails)}) or p.linkedin_url = any (${texts(urls)}))`,
    );
    if (others.length === 0) break;
    for (const id of others) for (const p of await familyRows(tx, id)) people.set(p.id, p);
    known = await identifiersOf(tx, Array.from(people.values()));
  }
  const family = Array.from(people.keys());
  const { roleIds, sources, emails, linkedinUrls } = known;
  const names = Array.from(new Set(Array.from(people.values()).map((p) => p.full_name.trim()).filter((n) => n.length >= 3)));
  const alsoErased = Array.from(people.values()).filter((p) => p.is_root && !first.some((f) => f.id === p.id)).map((p) => ({ id: p.id, fullName: p.full_name }));

  const byPerson = (table: string) => sql`select id from ${sql.raw(`dmi.${table}`)} where ${inIds("person_id", family)}`;
  const cascaded: Record<string, Ids> = { persons: family, roles: roleIds };
  for (const table of ["signals", "actions", "interactions", "briefs", "consents", "placements", "mandate_notes", "relationship_scores", "person_interests"]) {
    cascaded[table] = await column(tx, byPerson(table));
  }
  cascaded.signal_sources = await column(tx, sql`select id from dmi.signal_sources where ${inIds("signal_id", cascaded.signals!)}`);
  cascaded.drafts = await column(tx, sql`select id from dmi.drafts where ${inIds("action_id", cascaded.actions!)}`);
  cascaded.connections = await column(tx, sql`select id from dmi.connections where ${inIds("person_a_id", family)} or ${inIds("person_b_id", family)}`);

  const signals = cascaded.signals!;
  const idPatterns = [...family, ...roleIds, ...signals].map(containing);
  const emailPatterns = emails.map(containing);
  const identPatterns = [...emailPatterns, ...linkedinUrls.map(containing)];
  const nameRegexes = names.map(wholeWords);

  const rawItems = await column(
    tx,
    sql`select r.id from dmi.raw_items r where
          ${likeAny(sql`coalesce(r.payload::text, '')`, idPatterns)}
          or ${likeAny(sql`coalesce(r.payload::text, '') || ' ' || coalesce(r.title, '') || ' ' || coalesce(r.body_text, '')`, emailPatterns)}
          or (r.id in (select ss.raw_item_id from dmi.signal_sources ss where ${inIds("ss.signal_id", signals)})
              and not exists (select 1 from dmi.signal_sources o where o.raw_item_id = r.id and not ${inIds("o.signal_id", signals)}))`,
  );
  const queueItems = await column(tx, sql`select id from dmi.queue_items where ${likeAny(sql`payload::text`, idPatterns)}`);
  const threadKeys = (await tx.execute<{ key: string }>(sql`select distinct thread_key as key from dmi.interactions where ${inIds("person_id", family)} and thread_key is not null`)).rows.map((r) => r.key);
  const privacyMarks = await column(
    tx,
    sql`select m.id from dmi.privacy_marks m where
          (m.kind = 'person' and m.key = any (${texts(family)}))
          or (m.kind = 'thread' and m.key = any (${texts(threadKeys)})
              and not exists (select 1 from dmi.interactions i where i.thread_key = m.key and not ${inIds("i.person_id", family)}))`,
  );
  const notifications = await column(tx, sql`select id from dmi.notifications where ${likeAny(sql`subject || ' ' || body_text`, emailPatterns)} or ${matchAny(sql`subject || ' ' || body_text`, nameRegexes)}`);
  const linked = [...family, ...cascaded.interactions!, ...cascaded.actions!, ...cascaded.drafts!];
  const crm = (await tx.execute<{ id: string; entity_type: string }>(sql`select id, entity_type from dmi.crm_links where ${inIds("entity_id", linked)}`)).rows;
  const importBatches = await column(tx, sql`select id from dmi.import_batches where ${likeAny(sql`rows::text`, identPatterns)} or ${matchAny(sql`rows::text`, nameRegexes)}`);
  const calendar = (
    await tx.execute<{ id: string; person_ids: string[]; attendee_emails: string[] }>(sql`select id, person_ids, attendee_emails from dmi.calendar_events where person_ids && array[${list(family)}]::uuid[]`)
  ).rows.map((r) => ({ id: r.id, personIds: r.person_ids, attendeeEmails: r.attendee_emails }));

  return {
    rootId,
    family,
    alsoErased,
    names,
    emails,
    linkedinUrls,
    cascaded,
    fieldSources: sources.map((s) => s.id),
    rawItems,
    queueItems,
    privacyMarks,
    notifications,
    crmPersonLinks: crm.filter((c) => c.entity_type === "person").map((c) => c.id),
    crmOtherLinks: crm.filter((c) => c.entity_type !== "person").map((c) => c.id),
    importBatches,
    calendar,
  };
}

function uniqueBy(values: (string | null | undefined)[], key: (v: string) => string | null): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    if (!v) continue;
    const k = key(v);
    if (k && !seen.has(k)) seen.set(k, v);
  }
  return Array.from(seen.values());
}

/** What an erasure would remove, as counts, for the confirmation screen. */
export interface ErasurePreview {
  records: number;
  /** Separate records with one of the same addresses, erased too. */
  alsoErased: { id: string; fullName: string }[];
  roles: number;
  interactions: number;
  signals: number;
  actions: number;
  briefs: number;
  consents: number;
  fieldSources: number;
  identifiers: number;
  crmContacts: number;
}

export async function previewErasure(tx: Tx, personId: string): Promise<ErasurePreview> {
  const g = await gather(tx, personId);
  return {
    records: g.family.length,
    alsoErased: g.alsoErased,
    roles: g.cascaded.roles!.length,
    interactions: g.cascaded.interactions!.length,
    signals: g.cascaded.signals!.length,
    actions: g.cascaded.actions!.length,
    briefs: g.cascaded.briefs!.length,
    consents: g.cascaded.consents!.length,
    fieldSources: g.fieldSources.length,
    identifiers: g.emails.length + g.linkedinUrls.length,
    crmContacts: g.crmPersonLinks.length,
  };
}

export interface ErasureResult {
  /** The surviving record's id: the one the audit entry is about. Holds no personal data. */
  entityId: string;
  deleted: Record<string, number>;
  suppressions: number;
  auditEntriesRedacted: number;
  crmContactsMarked: number;
}

const REDACT_BATCH = 5_000;

/** Erases the person inside the caller's workspace transaction. */
export async function eraseInTx(tx: Tx, actor: Actor, personId: string): Promise<ErasureResult> {
  const g = await gather(tx, personId);

  let suppressions = 0;
  for (const email of g.emails) if (await addSuppression(tx, actor.workspaceId, "email", email, "erasure")) suppressions++;
  for (const url of g.linkedinUrls) if (await addSuppression(tx, actor.workspaceId, "linkedin", url, "erasure")) suppressions++;

  // Signals about someone else that were merged into one of theirs stand on their own again.
  await tx.execute(sql`update dmi.signals set merged_into_id = null where ${inIds("merged_into_id", g.cascaded.signals!)} and (person_id is null or not ${inIds("person_id", g.family)})`);

  // Calendar events: they leave the attendee lists; an event left with no tracked person goes.
  const emailKeys = new Set(g.emails.map((e) => normaliseEmail(e)));
  const calendarDeleted: Ids = [];
  for (const event of g.calendar) {
    const personIds = event.personIds.filter((p) => !g.family.includes(p));
    if (personIds.length === 0) {
      calendarDeleted.push(event.id);
      continue;
    }
    const attendeeEmails = event.attendeeEmails.filter((e) => !emailKeys.has(normaliseEmail(e) ?? e.trim().toLowerCase()));
    // The title may name them, and the event stays for the other attendees, so it goes.
    await tx.execute(sql`update dmi.calendar_events set person_ids = array[${list(personIds)}]::uuid[], attendee_emails = ${texts(attendeeEmails)}, title = null where id = ${event.id}::uuid`);
  }

  const remove = async (table: string, ids: Ids) => {
    if (ids.length) await tx.execute(sql`delete from ${sql.raw(`dmi.${table}`)} where ${inIds("id", ids)}`);
    return ids.length;
  };
  const deleted: Record<string, number> = {};
  deleted.calendar_events = await remove("calendar_events", calendarDeleted);
  deleted.queue_items = await remove("queue_items", g.queueItems);
  deleted.privacy_marks = await remove("privacy_marks", g.privacyMarks);
  deleted.notifications = await remove("notifications", g.notifications);
  deleted.raw_items = await remove("raw_items", g.rawItems);
  deleted.field_sources = await remove("field_sources", g.fieldSources);
  deleted.crm_links = await remove("crm_links", g.crmOtherLinks);
  // Contact links become delete instructions for the CRM, carried out after this transaction.
  if (g.crmPersonLinks.length) await tx.execute(sql`update dmi.crm_links set entity_type = 'erased_person' where ${inIds("id", g.crmPersonLinks)}`);

  // Their rows leave import files; the rest of each file and its report stay. A batch keeps its
  // parsed rows under "rows" (src/server/import-actions.ts); a bare array is handled too.
  if (g.importBatches.length) {
    const identPatterns = [...g.emails, ...g.linkedinUrls].map(containing);
    const nameRegexes = g.names.map(wholeWords);
    const kept = (array: SQL) => sql`coalesce((
        select jsonb_agg(e.value order by e.ordinality) from jsonb_array_elements(${array}) with ordinality e
        where not (${likeAny(sql`e.value::text`, identPatterns)} or ${matchAny(sql`e.value::text`, nameRegexes)})
      ), '[]'::jsonb)`;
    await tx.execute(sql`
      update dmi.import_batches b set rows = case
        when jsonb_typeof(b.rows) = 'array' then ${kept(sql`b.rows`)}
        when jsonb_typeof(b.rows->'rows') = 'array' then jsonb_set(b.rows, '{rows}', ${kept(sql`b.rows->'rows'`)})
        else b.rows end
      where ${inIds("b.id", g.importBatches)}`);
  }
  deleted.import_files_scrubbed = g.importBatches.length;

  // Personal data in the audit log, for every row this erasure removes.
  const everything = [
    ...Object.values(g.cascaded).flat(),
    ...g.fieldSources,
    ...g.rawItems,
    ...g.queueItems,
    ...g.privacyMarks,
    ...g.notifications,
    ...calendarDeleted,
  ];
  let auditEntriesRedacted = 0;
  for (let i = 0; i < everything.length; i += REDACT_BATCH) {
    const batch = everything.slice(i, i + REDACT_BATCH);
    const [row] = (await tx.execute<{ n: number }>(sql`select dmi.redact_audit(array[${list(batch)}]::uuid[]) as n`)).rows;
    auditEntriesRedacted += Number(row?.n ?? 0);
  }

  // The person rows, and everything that cascades from them. Links inside the set are cleared
  // first, so the order in which the cascades run cannot trip a self-reference.
  await tx.execute(sql`update dmi.signals set merged_into_id = null where ${inIds("id", g.cascaded.signals!)} and merged_into_id is not null`);
  await tx.execute(sql`update dmi.persons set merged_into_id = null where ${inIds("id", g.family)} and merged_into_id is not null`);
  await tx.execute(sql`delete from dmi.persons where ${inIds("id", g.family)}`);
  for (const [table, ids] of Object.entries(g.cascaded)) deleted[table] = ids.length;

  const result: ErasureResult = { entityId: g.rootId, deleted, suppressions, auditEntriesRedacted, crmContactsMarked: g.crmPersonLinks.length };
  await audit(tx, {
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    actorKind: actor.kind ?? "user",
    action: "person.erased",
    entityType: "person",
    entityId: g.rootId,
    after: { deleted, suppressions, audit_entries_redacted: auditEntriesRedacted, crm_contacts: g.crmPersonLinks.length },
  });
  return result;
}

/** One erasure run: the transaction above, then the CRM deletes it left behind. */
export async function erasePerson(actor: Actor, personId: string, options: { crmHttp?: HttpClient } = {}): Promise<ErasureResult & { crm: { deleted: number; pending: number } }> {
  const result = await withWorkspace(actor.workspaceId, (tx) => eraseInTx(tx, actor, personId));
  const crm = result.crmContactsMarked ? await deleteErasedContacts(actor.workspaceId, { http: options.crmHttp }) : { deleted: 0, pending: 0 };
  return { ...result, crm };
}
