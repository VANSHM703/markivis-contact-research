/**
 * Exports (BRD 18.2 access, 18.4 ownership and exit). Both are for the data steward only, both
 * are written to the audit log, and both arrive as one ZIP with JSON and CSV.
 *
 * - One person: everything held about them (their records, roles, every field source, every
 *   interaction, signals, actions and drafts, briefs, consents, scores, connections, interests,
 *   placements, mandate notes, calendar events they attend and the audit entries about them).
 * - The workspace: every table, as CSV and JSON, and a schema description. Tables are read in
 *   pages of 2,000 rows by id, so memory stays flat however large the workspace. Secrets never
 *   leave: token and secret ciphertext and the suppression salt are left out.
 */
import { sql, type SQL } from "drizzle-orm";
import { withWorkspace, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { csvLine, toCsv, toJson, type Row } from "@/lib/export/csv";
import type { ZipEntry } from "@/lib/export/zip";
import type { Actor } from "./records";

export class ExportError extends Error {}

/** Columns that never leave the database. */
export const EXCLUDED_COLUMNS: Record<string, string[]> = {
  workspaces: ["suppression_salt"],
  oauth_connections: ["token_ciphertext", "delta_cursor"],
  workspace_secrets: ["ciphertext"],
};

/** One line per table for the schema description (BRD 6). */
export const TABLE_NOTES: Record<string, string> = {
  workspaces: "The workspace: name, time zone, packs, flags and settings.",
  users: "People who sign in. Only members of this workspace are included.",
  workspace_members: "Membership and role of each user in this workspace.",
  persons: "Tracked people. merged_into_id points to the record a duplicate was merged into.",
  companies: "Companies, with ownership, size and client status.",
  roles: "A person's seats at companies: title, seniority, dates and business email.",
  sponsor_links: "Private equity sponsors of portfolio companies, with the deal partner.",
  connections: "Ties between two people (worked together, board together and so on).",
  person_interests: "Topics a person is interested in, and where that came from.",
  interactions: "Emails, meetings, calls and messages with a person. Subjects of private items are included.",
  capture_exclusions: "Addresses and domains a user chose never to capture.",
  briefs: "Meeting briefs.",
  calendar_events: "Calendar events with tracked people.",
  oauth_connections: "Mailbox and calendar connections. Tokens are left out.",
  feeds: "Configured sources.",
  usage_counters: "Monthly usage per provider (Apollo credits, AI spend).",
  raw_items: "Items fetched from sources, before and after the pipeline.",
  signals: "Detected changes, with lane, priority, status and the validator's decision.",
  signal_sources: "The sources behind each signal.",
  field_sources: "Where each field value came from, with confidence (provenance).",
  content_items: "The content library.",
  actions: "Suggested and completed outreach actions.",
  drafts: "Message drafts and what was sent.",
  relationship_scores: "Relationship scores and bands, firm-wide (user_id empty) and per user.",
  off_limits: "Off-limits rules.",
  placements: "Placements (executive search pack).",
  mandate_notes: "Confidential mandate notes (executive search pack).",
  consents: "Consent and lawful basis per person, channel and purpose.",
  suppressions: "The suppression list: salted hashes only, never the address itself.",
  source_stats_weekly: "Weekly counts and reject rates per source.",
  audit_log: "The audit log.",
  ai_calls: "AI calls: purpose, model, tokens, cost and latency. No prompts or answers.",
  workspace_secrets: "Which per-workspace credentials exist. The secrets themselves are left out.",
  queue_items: "Data conflicts, possible duplicates and other items for validators.",
  import_batches: "CSV imports: the parsed rows and the commit report.",
  notifications: "Email the platform sent: digests and alerts.",
  privacy_marks: "Threads and contacts marked private.",
  crm_links: "Which records exist in the CRM, under which CRM id.",
};

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
}

/** The workspace tables and their columns, as the database has them. */
export async function describeSchema(tx: Tx): Promise<{ tables: { name: string; description: string; columns: ColumnInfo[]; excluded: string[] }[]; enums: Record<string, string[]> }> {
  const cols = (
    await tx.execute<{ table_name: string; column_name: string; data_type: string; udt_name: string; is_nullable: string; column_default: string | null }>(sql`
      select c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'dmi' and t.table_type = 'BASE TABLE'
      order by c.table_name, c.ordinal_position`)
  ).rows;
  const tables = new Map<string, ColumnInfo[]>();
  for (const c of cols) {
    const type = c.data_type === "USER-DEFINED" ? `enum ${c.udt_name}` : c.data_type === "ARRAY" ? `${c.udt_name.replace(/^_/, "")}[]` : c.data_type;
    const list = tables.get(c.table_name) ?? [];
    list.push({ name: c.column_name, type, nullable: c.is_nullable === "YES", default: c.column_default });
    tables.set(c.table_name, list);
  }
  const enumRows = (
    await tx.execute<{ name: string; label: string }>(sql`
      select t.typname as name, e.enumlabel as label from pg_type t
      join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'dmi' order by t.typname, e.enumsortorder`)
  ).rows;
  const enums: Record<string, string[]> = {};
  for (const e of enumRows) (enums[e.name] ??= []).push(e.label);
  return {
    tables: Array.from(tables.entries()).map(([name, columns]) => {
      const excluded = EXCLUDED_COLUMNS[name] ?? [];
      return { name, description: TABLE_NOTES[name] ?? "", columns: columns.filter((c) => !excluded.includes(c.name)), excluded };
    }),
    enums,
  };
}

/** Selects the columns with timestamps as ISO 8601 in UTC. */
function selectList(columns: ColumnInfo[]): SQL {
  return sql.join(
    columns.map((c) => (c.type.startsWith("timestamp") ? sql`to_json(${sql.identifier(c.name)}) #>> '{}' as ${sql.identifier(c.name)}` : sql.identifier(c.name))),
    sql`, `,
  );
}

async function utc(tx: Tx): Promise<void> {
  await tx.execute(sql`set local time zone 'UTC'`);
}

const PAGE = 2_000;

async function* pages(workspaceId: string, table: string, columns: ColumnInfo[]): AsyncGenerator<Row[]> {
  let after: string | null = null;
  for (;;) {
    const cursor: string | null = after;
    const rows: Row[] = await withWorkspace(workspaceId, async (tx): Promise<Row[]> => {
      await utc(tx);
      return (await tx.execute<Row>(sql`select ${selectList(columns)} from ${sql.identifier("dmi")}.${sql.identifier(table)} ${cursor ? sql`where id > ${cursor}::uuid` : sql``} order by id limit ${PAGE}`)).rows;
    });
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < PAGE) return;
    after = String(rows.at(-1)!.id);
  }
}

async function* csvOf(workspaceId: string, table: string, columns: ColumnInfo[]): AsyncGenerator<string> {
  const names = columns.map((c) => c.name);
  yield csvLine(names);
  for await (const rows of pages(workspaceId, table, columns)) yield rows.map((r) => csvLine(names.map((n) => r[n]))).join("");
}

async function* jsonOf(workspaceId: string, table: string, columns: ColumnInfo[]): AsyncGenerator<string> {
  yield "[";
  let first = true;
  for await (const rows of pages(workspaceId, table, columns)) {
    yield (first ? "\n" : ",\n") + rows.map((r) => toJson(r)).join(",\n");
    first = false;
  }
  yield "\n]\n";
}

const README_WORKSPACE = (name: string, at: string) => `Workspace export: ${name}
Exported ${at} (UTC) by BEAM Decision-Maker Intelligence.

schema.json      every table with its columns, types and a short description, and every enum.
csv/<table>.csv  one file per table, with a header row. Arrays and JSON values are written as JSON.
json/<table>.json  the same rows as JSON arrays.

Timestamps are ISO 8601 in UTC. Left out on purpose: OAuth tokens, workspace secrets and the
suppression salt. Suppressions are salted hashes, so they cannot be read back as addresses.
`;

/** The full workspace export as ZIP entries. The export is audited before the first byte. */
export async function workspaceExport(actor: Actor, now = new Date()): Promise<{ filename: string; entries: AsyncGenerator<ZipEntry> }> {
  const { schema, name } = await withWorkspace(actor.workspaceId, async (tx) => {
    const described = await describeSchema(tx);
    const [ws] = (await tx.execute<{ name: string; slug: string }>(sql`select name, slug from dmi.workspaces where id = ${actor.workspaceId}::uuid`)).rows;
    await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: actor.kind ?? "user", action: "workspace.exported", entityType: "workspace", entityId: actor.workspaceId, after: { tables: described.tables.length } });
    return { schema: described, name: ws ?? { name: "Workspace", slug: "workspace" } };
  });
  const stamp = now.toISOString();
  async function* entries(): AsyncGenerator<ZipEntry> {
    yield { name: "README.txt", content: [README_WORKSPACE(name.name, stamp)] };
    yield { name: "schema.json", content: [toJson({ exported_at: stamp, ...schema }, 2)] };
    for (const table of schema.tables) {
      yield { name: `csv/${table.name}.csv`, content: csvOf(actor.workspaceId, table.name, table.columns) };
      yield { name: `json/${table.name}.json`, content: jsonOf(actor.workspaceId, table.name, table.columns) };
    }
  }
  return { filename: `${name.slug}-export-${stamp.slice(0, 10)}.zip`, entries: entries() };
}

// ---------------------------------------------------------------------------------------------
// One person (data subject access)
// ---------------------------------------------------------------------------------------------

const list = (ids: string[]) => (ids.length ? sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `) : sql`null::uuid`);

async function rowsOf(tx: Tx, query: SQL): Promise<Row[]> {
  return (await tx.execute<Row>(query)).rows;
}

/** Everything held about one person, by section. Merged duplicates are included. */
export async function personSections(tx: Tx, personId: string): Promise<{ rootId: string; sections: Record<string, Row[]> }> {
  await utc(tx);
  const family = (
    await tx.execute<{ id: string; is_root: boolean }>(sql`
      with recursive up(id, merged_into_id) as (
        select id, merged_into_id from dmi.persons where id = ${personId}::uuid
        union select p.id, p.merged_into_id from dmi.persons p join up on p.id = up.merged_into_id
      ), down(id) as (
        select id from up where merged_into_id is null
        union select p.id from dmi.persons p join down on p.merged_into_id = down.id
      )
      select id, merged_into_id is null as is_root from dmi.persons where id in (select id from down)`)
  ).rows;
  if (family.length === 0) throw new ExportError("Person not found.");
  const ids = family.map((f) => f.id);
  const rootId = family.find((f) => f.is_root)?.id ?? ids[0]!;

  const person = (table: string, where: SQL) => rowsOf(tx, sql`select * from ${sql.identifier("dmi")}.${sql.identifier(table)} where ${where} order by created_at`);
  const byPerson = sql`person_id in (${list(ids)})`;
  const sections: Record<string, Row[]> = {};
  sections.person = await person("persons", sql`id in (${list(ids)})`);
  sections.roles = await person("roles", byPerson);
  const roleIds = sections.roles.map((r) => String(r.id));
  sections.field_sources = await person("field_sources", sql`(entity_type = 'person' and entity_id in (${list(ids)})) or (entity_type = 'role' and entity_id in (${list(roleIds)}))`);
  sections.interactions = await person("interactions", byPerson);
  sections.signals = await person("signals", byPerson);
  const signalIds = sections.signals.map((r) => String(r.id));
  sections.signal_sources = await person("signal_sources", sql`signal_id in (${list(signalIds)})`);
  sections.actions = await person("actions", byPerson);
  const actionIds = sections.actions.map((r) => String(r.id));
  sections.drafts = await person("drafts", sql`action_id in (${list(actionIds)})`);
  sections.briefs = await person("briefs", byPerson);
  sections.consents = await person("consents", byPerson);
  sections.relationship_scores = await person("relationship_scores", byPerson);
  sections.connections = await person("connections", sql`person_a_id in (${list(ids)}) or person_b_id in (${list(ids)})`);
  sections.person_interests = await person("person_interests", byPerson);
  sections.placements = await person("placements", byPerson);
  sections.mandate_notes = await person("mandate_notes", byPerson);
  // Other attendees' addresses are someone else's data, so only the event itself is included.
  sections.calendar_events = await rowsOf(tx, sql`select id, provider, starts_at, ends_at, title from dmi.calendar_events where person_ids && array[${list(ids)}]::uuid[] order by starts_at`);
  const about = [...ids, ...roleIds, ...signalIds, ...actionIds, ...sections.interactions.map((r) => String(r.id)), ...sections.consents.map((r) => String(r.id))];
  sections.audit_log = await rowsOf(tx, sql`select id, action, entity_type, entity_id, actor_kind, at, before, after from dmi.audit_log where entity_id in (${list(about)}) order by at`);

  // Timestamps as ISO 8601 strings, whatever the driver returned.
  for (const rows of Object.values(sections)) {
    for (const row of rows) for (const [k, v] of Object.entries(row)) if (typeof v === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?\+00$/.test(v)) row[k] = `${v.replace(" ", "T").replace(/\+00$/, "Z")}`;
  }
  return { rootId, sections };
}

const README_PERSON = (at: string) => `Personal data export
Exported ${at} (UTC) by BEAM Decision-Maker Intelligence, for a data subject access request.

person.json          everything below in one file, by section.
csv/<section>.csv    one file per section, with a header row.

Sections: the person record (and any duplicate records merged into it), roles, field sources
(where each value came from), interactions, signals and their sources, actions and drafts,
briefs, consents, relationship scores, connections, interests, placements, mandate notes,
calendar events they attend, and audit entries about any of these. Timestamps are in UTC.
`;

/** One person's export as ZIP entries. Audited, with each mandate note written as exported. */
export async function personExport(actor: Actor, personId: string, now = new Date()): Promise<{ filename: string; entries: ZipEntry[] }> {
  const { rootId, sections } = await withWorkspace(actor.workspaceId, async (tx) => {
    const found = await personSections(tx, personId);
    const counts = Object.fromEntries(Object.entries(found.sections).map(([k, v]) => [k, v.length]));
    await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: actor.kind ?? "user", action: "person.exported", entityType: "person", entityId: found.rootId, after: { sections: counts } });
    for (const note of found.sections.mandate_notes ?? []) {
      await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: actor.kind ?? "user", action: "mandate_note.exported", entityType: "mandate_note", entityId: String(note.id) });
    }
    return found;
  });
  const stamp = now.toISOString();
  const entries: ZipEntry[] = [
    { name: "README.txt", content: [README_PERSON(stamp)] },
    { name: "person.json", content: [toJson({ exported_at: stamp, person_id: rootId, sections }, 2)] },
  ];
  for (const [name, rows] of Object.entries(sections)) {
    const columns = rows.length ? Object.keys(rows[0]!) : ["id"];
    entries.push({ name: `csv/${name}.csv`, content: [toCsv(columns, rows)] });
  }
  return { filename: `person-${rootId.slice(0, 8)}-export-${stamp.slice(0, 10)}.zip`, entries };
}
