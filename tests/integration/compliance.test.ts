/**
 * Compliance and administration (BRD 18, 5.3, 14, 24.1): acceptance scenario 22 (erasure), the
 * access export and the workspace export, do not contact and the suppression list, the retention
 * review, members and roles, break-glass access, the shadow run and the content library.
 * Rebuilds the test database before and after.
 */
import { readFileSync } from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMockAi } from "@/ai/mock";
import { closeDatabase, withSystem, withWorkspace, type Tx } from "@/db/client";
import * as s from "@/db/schema";
import { loadSeed } from "@/db/seed";
import { stageDemoCompliance } from "@/db/seed/demo-compliance";
import { setPersonPrivate, setThreadPrivate } from "@/capture/privacy";
import { mockHubSpotHttp, runCrmSync } from "@/crm/sync";
import { createActionForSignal, draftForAction } from "@/domain/actions";
import { endBreakGlass, platformOverview, startBreakGlass } from "@/domain/break-glass";
import { addManualSuppression, checkSuppression, parseIdentifier, recordConsent, removeManualSuppression, setDoNotContact } from "@/domain/consent";
import { addContentItem, commitContent, ContentError, previewContent, saveTopics } from "@/domain/content";
import { erasePerson, previewErasure } from "@/domain/erasure";
import { ExportError, personExport, workspaceExport } from "@/domain/exports";
import { previewTargetList } from "@/domain/imports/target-list";
import { addMandateNote } from "@/domain/mandate-notes";
import { changeMemberRole, inviteMember, listMembers, MemberError, removeMember } from "@/domain/members";
import { mergePersons } from "@/domain/merge";
import { isSuppressed, SuppressedError, suppressionHash, workspaceSalt } from "@/domain/suppression";
import { upsertPerson } from "@/domain/records";
import { keepInRetention, retentionCandidates, runRetentionReview } from "@/domain/retention";
import { promoteShadow, shadowReport, startShadowRun } from "@/domain/shadow";
import type { HttpClient } from "@/ingest/http";
import { runSource } from "@/ingest/run";
import { audit } from "@/lib/audit";
import { resolveSignIn } from "@/lib/identity";
import { normaliseName } from "@/lib/normalise";
import { queueNotification } from "@/mail/notify";
import { rejectSignal } from "@/pipeline/validation";
import { zip } from "@/lib/export/zip";
import { resetDatabase } from "../../scripts/migrate";
import { readAll, unzip } from "../helpers/unzip";
import { loadFixtures, type WorkspaceFixture } from "./helpers";
import { SEED_NOW, TEST_DATABASE_ENV } from "./env";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: { GET: vi.fn(), POST: vi.fn() }, isMockSignInEnabled: () => true }));
const { buildContext } = await import("@/lib/context");

const NOW = new Date(SEED_NOW);
const DAY = 86_400_000;
const ai = createMockAi(() => NOW);
let demo: WorkspaceFixture;
let harbor: WorkspaceFixture;
const users = {} as Record<"partner" | "steward" | "validator" | "platform" | "harborPartner", string>;

async function rebuild() {
  await closeDatabase();
  await resetDatabase(TEST_DATABASE_ENV.DATABASE_MIGRATE_URL);
  await loadSeed(SEED_NOW);
}
const inDemo = <T>(fn: (tx: Tx) => Promise<T>) => withWorkspace(demo.id, fn);
const steward = () => ({ workspaceId: demo.id, userId: users.steward });
const partner = () => ({ workspaceId: demo.id, userId: users.partner });

/** Every text, JSON and array column in every table, as the system role: where the value appears. */
async function findAnywhere(needle: string): Promise<string[]> {
  return withSystem("test", async (tx) => {
    const cols = (
      await tx.execute<{ table_name: string; column_name: string }>(sql`
        select c.table_name, c.column_name from information_schema.columns c
        join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'dmi' and t.table_type = 'BASE TABLE' and c.data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY')`)
    ).rows;
    const pattern = `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const hits: string[] = [];
    for (const c of cols) {
      const [row] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier("dmi")}.${sql.identifier(c.table_name)} where ${sql.identifier(c.column_name)}::text ilike ${pattern}`)).rows;
      if (row!.n > 0) hits.push(`${c.table_name}.${c.column_name}`);
    }
    return hits;
  });
}

beforeAll(async () => {
  await rebuild();
  ({ demo, harbor } = await loadFixtures());
  const rows = await withSystem("test", (tx) =>
    tx.select({ id: s.users.id, email: s.users.email, role: s.workspaceMembers.role, ws: s.workspaceMembers.workspaceId }).from(s.users).leftJoin(s.workspaceMembers, eq(s.workspaceMembers.userId, s.users.id)),
  );
  users.partner = rows.find((r) => r.ws === demo.id && r.role === "partner")!.id;
  users.steward = rows.find((r) => r.ws === demo.id && r.role === "data_steward")!.id;
  users.validator = rows.find((r) => r.ws === demo.id && r.role === "validator")!.id;
  users.harborPartner = rows.find((r) => r.ws === harbor.id && r.role === "partner")!.id;
  users.platform = rows.find((r) => r.email === "alex.moreau@markivis.example.com")!.id;
}, 120_000);

afterAll(async () => {
  await rebuild();
  await closeDatabase();
}, 120_000);

// ---------------------------------------------------------------------------------------------
// Scenario 22
// ---------------------------------------------------------------------------------------------

describe("erasure (acceptance scenario 22)", () => {
  const apolloPeople = JSON.parse(readFileSync("fixtures/apollo/people.json", "utf8")) as { email?: string; linkedin_url?: string }[];
  const hubspotCalls: { url: string; body: unknown }[] = [];
  const base = mockHubSpotHttp(() => NOW);
  const hubspot: HttpClient = { mode: "mock", request: async (req) => (hubspotCalls.push({ url: req.url, body: req.body }), base.request(req)) };
  let p: { id: string; name: string; email: string; linkedin: string | null; companyId: string };
  let twin: string;
  let shell: string;
  let other: { id: string; email: string };
  let crmId: string;
  let sharedEvent: string;
  let identifiers = 0;
  let allEmails: string[] = [];

  it("sets up a person with a record in every part of the product", async () => {
    const emails = apolloPeople.map((x) => x.email?.toLowerCase()).filter((e): e is string => !!e);
    const [found] = await inDemo((tx) =>
      tx
        .select({ id: s.persons.id, name: s.persons.fullName, email: s.roles.businessEmail, linkedin: s.persons.linkedinUrl, companyId: s.roles.companyId })
        .from(s.persons)
        .innerJoin(s.roles, and(eq(s.roles.personId, s.persons.id), eq(s.roles.isPrimary, true)))
        // Nobody else shares the name, so the name check below can only find them.
        .where(and(inArray(s.roles.businessEmail, emails), sql`not exists (select 1 from dmi.persons o where o.full_name = ${s.persons.fullName} and o.id <> ${s.persons.id})`))
        .orderBy(s.persons.fullName)
        .limit(1),
    );
    expect(found, "a seeded person whose email is in the Apollo fixture").toBeDefined();
    p = { ...found!, email: found!.email! };
    const [o] = await inDemo((tx) => tx.select({ id: s.persons.id, email: s.roles.businessEmail }).from(s.persons).innerJoin(s.roles, and(eq(s.roles.personId, s.persons.id), eq(s.roles.isPrimary, true))).where(sql`${s.persons.id} <> ${p.id} and ${s.roles.businessEmail} is not null`).limit(1));
    other = { id: o!.id, email: o!.email! };

    // Apollo observes their email (field sources); HubSpot gets them as a contact.
    await runSource(demo.id, "apollo", { mode: "mock", now: () => NOW });
    await withSystem("test", (tx) => tx.update(s.workspaces).set({ flags: sql`${s.workspaces.flags} || '{"crm.hubspot": true}'::jsonb` }).where(eq(s.workspaces.id, demo.id)));

    const actionId = await inDemo(async (tx) => {
      // A duplicate merged into them, and a second record with the same email that nobody merged.
      const [dup] = await tx.insert(s.persons).values({ workspaceId: demo.id, fullName: p.name, nameNormalised: normaliseName(p.name), city: "Duplicate City" }).returning({ id: s.persons.id });
      await mergePersons(tx, { workspaceId: demo.id, userId: users.partner }, p.id, dup!.id);
      shell = dup!.id;
      const [second] = await tx.insert(s.persons).values({ workspaceId: demo.id, fullName: `${p.name} Jr`, nameNormalised: normaliseName(`${p.name} Jr`) }).returning({ id: s.persons.id });
      await tx.insert(s.roles).values({ workspaceId: demo.id, personId: second!.id, companyId: p.companyId, seatType: "board", title: "Board member", businessEmail: p.email, status: "current" });
      twin = second!.id;

      await tx.insert(s.interactions).values({ workspaceId: demo.id, personId: p.id, channel: "email", direction: "two_way", occurredAt: new Date(NOW.getTime() - 5 * DAY), ourUserId: users.partner, subject: `Lunch with ${p.name}`, threadKey: "thread-erase-1", provider: "manual", capturedBy: "manual" });
      await setThreadPrivate(tx, { workspaceId: demo.id, userId: users.partner, role: "partner" }, "thread-erase-1", true);
      await setPersonPrivate(tx, { workspaceId: demo.id, userId: users.partner, role: "partner" }, p.id, true);
      await recordConsent(tx, steward(), p.id, { channel: "email", purpose: "outreach", status: "legitimate_interest", jurisdiction: "US", proof: `Existing relationship with ${p.name}` }, NOW);
      await tx.insert(s.personInterests).values({ workspaceId: demo.id, personId: p.id, topic: "CEO succession", source: "manual" });
      await tx.insert(s.relationshipScores).values({ workspaceId: demo.id, personId: p.id, userId: null, score: 60, band: "warm", factors: { note: p.name } });
      const [a, b] = [p.id, other.id].sort() as [string, string];
      await tx.insert(s.connections).values({ workspaceId: demo.id, personAId: a, personBId: b, type: "manual_other", weight: "0.50", derived: false, note: `Met ${p.name} at a dinner` });
      await tx.insert(s.placements).values({ workspaceId: demo.id, personId: p.id, companyId: p.companyId, roleTitle: "Chief Executive Officer", placedOn: "2024-01-15" });
      await addMandateNote(tx, { workspaceId: demo.id, userId: users.partner, role: "partner" }, { personId: p.id }, `Confidential: ${p.name} is open to a move`);

      const [solo] = await tx.insert(s.calendarEvents).values({ workspaceId: demo.id, userId: users.partner, provider: "microsoft", externalId: "erase-solo", startsAt: new Date(NOW.getTime() + DAY), endsAt: new Date(NOW.getTime() + DAY + 3_600_000), title: `Coffee with ${p.name}`, attendeeEmails: [p.email], personIds: [p.id] }).returning({ id: s.calendarEvents.id });
      const [shared] = await tx.insert(s.calendarEvents).values({ workspaceId: demo.id, userId: users.partner, provider: "microsoft", externalId: "erase-shared", startsAt: new Date(NOW.getTime() + 2 * DAY), endsAt: new Date(NOW.getTime() + 2 * DAY + 3_600_000), title: `Board prep with ${p.name}`, attendeeEmails: [p.email, other.email], personIds: [p.id, other.id] }).returning({ id: s.calendarEvents.id });
      sharedEvent = shared!.id;
      await tx.insert(s.briefs).values({ workspaceId: demo.id, personId: p.id, calendarEventId: solo!.id, contentMarkdown: `# ${p.name}\n\nBrief.` });

      await tx.insert(s.queueItems).values({ workspaceId: demo.id, kind: "possible_duplicate", payload: { person_ids: [p.id, other.id], reason: "Same name" } });
      await queueNotification(tx, { workspaceId: demo.id, userId: users.partner, toEmail: "jordan.ellis@demo-search.example.com", kind: "p1_change", dedupeKey: "erase-test", subject: `Priority 1: ${p.name} was promoted`, bodyText: `${p.name} was promoted.` });
      await tx.insert(s.importBatches).values({ workspaceId: demo.id, kind: "target_list", filename: "list.csv", createdBy: users.partner, rows: { rows: [{ rowNumber: 2, raw: { full_name: p.name, email: p.email } }, { rowNumber: 3, raw: { full_name: "Someone Else", email: "someone.else@example.com" } }], summary: { rows: 2 } } });
      await tx.insert(s.rawItems).values([
        { workspaceId: demo.id, sourceType: "newsletter", externalId: "erase-newsletter", title: "click", payload: { email: p.email, event: "click" } },
        { workspaceId: demo.id, sourceType: "apollo", externalId: `apollo:change:${p.id}:test`, title: `Apollo: ${p.name} moved`, payload: { person_id: p.id } },
      ]);
      await audit(tx, { workspaceId: demo.id, actorUserId: users.partner, actorKind: "user", action: "person.updated", entityType: "person", entityId: p.id, before: { city: "Old" }, after: { business_email: p.email, full_name: p.name } });

      const [signal] = await tx.insert(s.signals).values({ workspaceId: demo.id, subjectType: "person", personId: p.id, type: "person_promotion", headline: `${p.name} promoted`, foundBy: "feed_rule", confidence: "high", priority: 1, lane: "review", status: "confirmed", confirmedAt: NOW, dedupeKey: `erase:${p.id}` }).returning();
      const [wire] = await tx.insert(s.rawItems).values({ workspaceId: demo.id, sourceType: "press_wire", externalId: "erase-wire", title: `${p.name} promoted`, bodyText: `${p.name} was promoted today.` }).returning({ id: s.rawItems.id });
      await tx.insert(s.signalSources).values({ workspaceId: demo.id, signalId: signal!.id, rawItemId: wire!.id, sourceType: "press_wire", title: `${p.name} promoted` });
      const created = await createActionForSignal(tx, signal!, NOW);
      return created!.actionId;
    });
    expect(await draftForAction(demo.id, actionId, { ai, now: () => NOW })).toMatchObject({ kind: "drafted" });

    const sync = await runCrmSync(demo.id, { http: hubspot, now: NOW });
    expect(sync).toMatchObject({ erased: 0 });
    const [link] = await inDemo((tx) => tx.select({ crmId: s.crmLinks.crmId }).from(s.crmLinks).where(and(eq(s.crmLinks.entityType, "person"), eq(s.crmLinks.entityId, p.id))));
    expect(link).toBeDefined();
    crmId = link!.crmId;

    expect(await findAnywhere(p.email)).not.toEqual([]);
    const preview = await inDemo((tx) => previewErasure(tx, p.id));
    expect(preview).toMatchObject({ records: 3, crmContacts: 1 });
    expect(preview.interactions).toBeGreaterThanOrEqual(1);
    expect(preview.consents).toBeGreaterThanOrEqual(1);
    // Every address they have held, past roles included, plus their LinkedIn profile.
    allEmails = Array.from(new Set((await inDemo((tx) => tx.select({ e: s.roles.businessEmail }).from(s.roles).where(inArray(s.roles.personId, [p.id, twin])))).map((r) => r.e).filter((e): e is string => !!e)));
    identifiers = allEmails.length + (p.linkedin ? 1 : 0);
    expect(preview.identifiers).toBe(identifiers);
    expect(preview.alsoErased.map((r) => r.id)).toEqual([twin]);
  });

  it("deletes every row about them, writes their suppression hashes, and keeps an audit entry without personal data", async () => {
    const before = await withSystem("test", async (tx) => (await tx.execute<{ n: number }>(sql`select count(*)::int as n from dmi.persons where workspace_id = ${demo.id}::uuid`)).rows[0]!.n);
    const result = await erasePerson({ workspaceId: demo.id, userId: users.steward }, p.id, { crmHttp: hubspot });
    expect(result.crm).toEqual({ deleted: 1, pending: 0 });
    expect(result.deleted.persons).toBe(3);
    expect(result.suppressions).toBe(identifiers);
    expect(result.auditEntriesRedacted).toBeGreaterThan(0);

    // Every identifier, and the name, is gone from every column of every table.
    for (const email of allEmails) expect(await findAnywhere(email), email).toEqual([]);
    if (p.linkedin) expect(await findAnywhere(p.linkedin)).toEqual([]);
    expect(await findAnywhere(p.name)).toEqual([]);

    await inDemo(async (tx) => {
      const n = async (q: Promise<unknown[]>) => (await q).length;
      expect(await n(tx.select().from(s.persons).where(inArray(s.persons.id, [p.id, shell, twin])))).toBe(0);
      expect(await n(tx.select().from(s.persons))).toBe(before - 3);
      expect(await n(tx.select().from(s.crmLinks).where(eq(s.crmLinks.entityType, "erased_person")))).toBe(0);
      expect(await n(tx.select().from(s.privacyMarks).where(eq(s.privacyMarks.key, p.id)))).toBe(0);
      const [event] = await tx.select().from(s.calendarEvents).where(eq(s.calendarEvents.id, sharedEvent));
      expect(event).toMatchObject({ personIds: [other.id], attendeeEmails: [other.email], title: null });
      const [batch] = await tx.select({ rows: s.importBatches.rows }).from(s.importBatches).where(eq(s.importBatches.filename, "list.csv"));
      expect((batch!.rows as { rows: unknown[] }).rows).toHaveLength(1);

      for (const value of [...allEmails, ...(p.linkedin ? [p.linkedin] : [])]) {
        expect(await checkSuppression(tx, demo.id, value), `${value} suppressed`).toMatchObject({ reason: "erasure" });
      }
      const [entry] = await tx.select().from(s.auditLog).where(eq(s.auditLog.action, "person.erased"));
      expect(entry).toMatchObject({ entityId: p.id, actorUserId: users.steward });
      expect(JSON.stringify(entry!.after)).not.toContain(p.email);
      const leftover = await tx.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, p.id), sql`${s.auditLog.action} <> 'person.erased'`, sql`coalesce(${s.auditLog.after}, ${s.auditLog.before})::text <> '{"redacted": true}'`));
      expect(leftover).toEqual([]);
    });

    const deletes = hubspotCalls.filter((c) => c.url.endsWith("/crm/v3/objects/contacts/gdpr-delete"));
    expect(deletes.map((d) => (d.body as { objectId: string }).objectId)).toContain(crmId);
  });

  it("creates nothing from a later Apollo response, import or record with their email", async () => {
    await runSource(demo.id, "apollo", { mode: "mock", now: () => NOW });
    expect(await findAnywhere(p.email)).toEqual([]);

    // A record that predates the suppression (restored from a backup, say) still gets nothing from Apollo.
    const restored = await withSystem("test", async (tx) => {
      const [r] = await tx.insert(s.persons).values({ workspaceId: demo.id, fullName: "Restored Record", nameNormalised: "restored record" }).returning({ id: s.persons.id });
      const [role] = await tx.insert(s.roles).values({ workspaceId: demo.id, personId: r!.id, companyId: p.companyId, seatType: "executive", title: "Chief Executive Officer", businessEmail: p.email, status: "current", isPrimary: true }).returning({ id: s.roles.id });
      return { personId: r!.id, roleId: role!.id };
    });
    const run = await runSource(demo.id, "apollo", { mode: "mock", now: () => NOW, apollo: { personIds: [restored.personId] } });
    expect(run.feeds[0]).toMatchObject({ ok: true, created: 0 });
    await inDemo(async (tx) => {
      expect(await tx.select().from(s.fieldSources).where(and(eq(s.fieldSources.entityId, restored.roleId), eq(s.fieldSources.sourceType, "apollo")))).toEqual([]);
      expect(await tx.select().from(s.rawItems).where(sql`${s.rawItems.payload}::text like ${`%${restored.personId}%`}`)).toEqual([]);
      await tx.delete(s.persons).where(eq(s.persons.id, restored.personId));
    });

    // Manual entry and the target list import refuse them.
    await inDemo(async (tx) => {
      await expect(upsertPerson(tx, { workspaceId: demo.id, userId: users.partner }, { fullName: p.name }, [{ companyId: p.companyId, title: "Chief Executive Officer", businessEmail: p.email }], { sourceType: "manual", note: "test" })).rejects.toBeInstanceOf(SuppressedError);
      const preview = await previewTargetList(tx, demo.id, [{ rowNumber: 2, raw: { company_name: "Any Company", person_full_name: p.name, person_title: "Chief Executive Officer", person_email: p.email } }], []);
      expect(preview.rows[0]!.person).toBe("suppressed");
      expect(await isSuppressed(tx, demo.id, { emails: [p.email.toUpperCase()] })).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------------------------

describe("exports (BRD 18.2 access, 18.4 ownership)", () => {
  it("exports everything held about one person, audited, and never another workspace's person", async () => {
    const [person] = await inDemo((tx) => tx.select({ id: s.persons.id, name: s.persons.fullName }).from(s.persons).innerJoin(s.roles, and(eq(s.roles.personId, s.persons.id), eq(s.roles.isPrimary, true))).where(sql`${s.roles.businessEmail} is not null`).limit(1));
    await inDemo((tx) => addMandateNote(tx, { workspaceId: demo.id, userId: users.partner, role: "partner" }, { personId: person!.id }, "A note for the export test"));
    const { filename, entries } = await personExport(steward(), person!.id, NOW);
    expect(filename).toMatch(/^person-.*-export-2026-09-30\.zip$/);
    const files = unzip(await readAll(zip(entries, NOW)));
    expect([...files.keys()]).toEqual(expect.arrayContaining(["README.txt", "person.json", "csv/person.csv", "csv/roles.csv", "csv/field_sources.csv", "csv/interactions.csv", "csv/mandate_notes.csv", "csv/audit_log.csv"]));
    const json = JSON.parse(files.get("person.json")!.toString()) as { sections: Record<string, Record<string, unknown>[]> };
    expect(json.sections.person![0]).toMatchObject({ id: person!.id, full_name: person!.name });
    expect(json.sections.roles!.length).toBeGreaterThan(0);
    expect(json.sections.mandate_notes!.some((n) => n.body === "A note for the export test")).toBe(true);
    expect(files.get("csv/person.csv")!.toString()).toContain(person!.name);

    await inDemo(async (tx) => {
      expect(await tx.select().from(s.auditLog).where(and(eq(s.auditLog.action, "person.exported"), eq(s.auditLog.entityId, person!.id)))).toHaveLength(1);
      expect((await tx.select().from(s.auditLog).where(eq(s.auditLog.action, "mandate_note.exported"))).length).toBe(json.sections.mandate_notes!.length);
    });
    await expect(personExport(steward(), harbor.personIds[0]!, NOW)).rejects.toBeInstanceOf(ExportError);
  });

  it("exports every table as CSV and JSON with a schema, without secrets or another workspace's rows", async () => {
    const { entries } = await workspaceExport(steward(), NOW);
    const files = unzip(await readAll(zip(entries, NOW)));
    const schema = JSON.parse(files.get("schema.json")!.toString()) as { tables: { name: string; columns: { name: string }[]; excluded: string[] }[]; enums: Record<string, string[]> };
    const tables = schema.tables.map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["persons", "roles", "audit_log", "suppressions", "workspace_secrets", "break_glass_grants"]));
    for (const t of tables) {
      expect(files.has(`csv/${t}.csv`), t).toBe(true);
      expect(files.has(`json/${t}.json`), t).toBe(true);
    }
    expect(schema.enums.member_role).toContain("data_steward");
    expect(schema.tables.find((t) => t.name === "workspaces")!.columns.map((c) => c.name)).not.toContain("suppression_salt");
    expect(files.get("csv/oauth_connections.csv")!.toString().split("\r\n")[0]).not.toContain("token_ciphertext");
    expect(files.get("csv/workspaces.csv")!.toString()).not.toContain("suppression_salt");

    const persons = JSON.parse(files.get("json/persons.json")!.toString()) as { id: string; created_at: string }[];
    const count = await inDemo(async (tx) => (await tx.select({ id: s.persons.id }).from(s.persons)).length);
    expect(persons).toHaveLength(count);
    expect(persons[0]!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00$/);
    expect(files.get("csv/persons.csv")!.toString().trim().split("\r\n")).toHaveLength(count + 1);

    const everything = [...files.values()].map((b) => b.toString()).join("\n");
    for (const id of [harbor.id, ...harbor.personIds, ...harbor.companyIds]) expect(everything.includes(id), id).toBe(false);
    await inDemo(async (tx) => expect(await tx.select().from(s.auditLog).where(eq(s.auditLog.action, "workspace.exported"))).toHaveLength(1));
  });
});

// ---------------------------------------------------------------------------------------------
// Consent, do not contact and the suppression list
// ---------------------------------------------------------------------------------------------

describe("do not contact and the suppression list (BRD 18.1)", () => {
  it("blocks a person everywhere, closes their open actions, and clears only what it added", async () => {
    const [target] = await inDemo((tx) =>
      tx
        .select({ id: s.persons.id, email: s.roles.businessEmail })
        .from(s.persons)
        .innerJoin(s.roles, and(eq(s.roles.personId, s.persons.id), eq(s.roles.isPrimary, true)))
        .where(and(eq(s.persons.status, "active"), eq(s.persons.country, "US"), sql`${s.roles.businessEmail} is not null`))
        .limit(1),
    );
    expect(target).toBeDefined();
    await inDemo(async (tx) => {
      const [signal] = await tx.insert(s.signals).values({ workspaceId: demo.id, subjectType: "person", personId: target!.id, type: "person_promotion", headline: "Promoted to the executive committee", foundBy: "feed_rule", confidence: "high", priority: 1, lane: "review", status: "confirmed", confirmedAt: NOW, dedupeKey: `dnc:${target!.id}` }).returning();
      expect(await createActionForSignal(tx, signal!, NOW)).toBeTruthy();
    });
    await inDemo(async (tx) => {
      expect(await addManualSuppression(tx, steward(), target!.email!, "opt_out")).toBe("added");
      const { dismissed } = await setDoNotContact(tx, steward(), target!.id, true, NOW);
      expect(dismissed).toBeGreaterThan(0);
      const [person] = await tx.select({ status: s.persons.status }).from(s.persons).where(eq(s.persons.id, target!.id));
      expect(person!.status).toBe("do_not_contact");
      const open = await tx.select().from(s.actions).where(and(eq(s.actions.personId, target!.id), inArray(s.actions.status, ["open", "drafted", "awaiting_approval", "approved"])));
      expect(open).toEqual([]);
      expect((await tx.select().from(s.actions).where(and(eq(s.actions.personId, target!.id), eq(s.actions.dismissReason, "do_not_contact")))).length).toBe(dismissed);

      await setDoNotContact(tx, steward(), target!.id, false, NOW);
      const [after] = await tx.select({ status: s.persons.status }).from(s.persons).where(eq(s.persons.id, target!.id));
      expect(after!.status).toBe("active");
      // The opt-out entry was there first, so the address stays suppressed.
      expect(await checkSuppression(tx, demo.id, target!.email!)).toMatchObject({ reason: "opt_out" });
      expect(await removeManualSuppression(tx, steward(), target!.email!)).toBe("removed");
      expect(await checkSuppression(tx, demo.id, target!.email!)).toMatchObject({ reason: null });
    });
  });

  it("adds and removes addresses by hand, keeps erasure entries, and never writes the address to the audit log", async () => {
    await inDemo(async (tx) => {
      expect(parseIdentifier("not an address")).toBeNull();
      expect(parseIdentifier("https://www.linkedin.com/company/acme")).toBeNull();
      expect(parseIdentifier(" Someone@Example.COM ")).toEqual({ kind: "email", value: "someone@example.com" });
      expect(await addManualSuppression(tx, steward(), "phoned.in@example.com", "do_not_contact")).toBe("added");
      expect(await addManualSuppression(tx, steward(), "PHONED.IN@example.com", "opt_out")).toBe("already");
      expect(await checkSuppression(tx, demo.id, "phoned.in@example.com")).toMatchObject({ kind: "email", reason: "do_not_contact" });
      await tx.insert(s.suppressions).values({ workspaceId: demo.id, kind: "email", reason: "erasure", hash: suppressionHash(await workspaceSalt(tx, demo.id), "email", "erased.for.good@example.com")! });
      expect(await removeManualSuppression(tx, steward(), "erased.for.good@example.com")).toBe("erasure");
      expect(await removeManualSuppression(tx, steward(), "never.listed@example.com")).toBe("not_found");
    });
    expect(await findAnywhere("phoned.in@example.com")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Retention review
// ---------------------------------------------------------------------------------------------

describe("retention review (BRD 18.2)", () => {
  it("lists people with no current role and no contact for 24 months, keeps for 12 months, and emails the steward monthly", async () => {
    expect(await stageDemoCompliance(demo.id, NOW)).toEqual({ former: 4, suppressed: 2 });
    const { rows, total } = await inDemo((tx) => retentionCandidates(tx, NOW));
    expect(total).toBe(4);
    expect(rows.map((r) => r.fullName)).toContain("Harriet Vossberg");
    const harriet = rows.find((r) => r.fullName === "Harriet Vossberg")!;

    // Contact in the last 24 months takes them off the list.
    const pell = rows.find((r) => r.fullName === "Ignatius Pell")!;
    await inDemo((tx) => tx.insert(s.interactions).values({ workspaceId: demo.id, personId: pell.id, channel: "call", direction: "two_way", occurredAt: new Date(NOW.getTime() - 30 * DAY), provider: "manual", capturedBy: "manual" }));
    await inDemo((tx) => keepInRetention(tx, steward(), harriet.id, NOW));
    expect((await inDemo((tx) => retentionCandidates(tx, NOW))).rows.map((r) => r.fullName).sort()).toEqual(["Marguerite Sandvik", "Tobias Wrenfield"]);
    const later = new Date(NOW.getTime() + 380 * DAY);
    expect((await inDemo((tx) => retentionCandidates(tx, later))).rows.map((r) => r.fullName)).toContain("Harriet Vossberg");

    expect(await runRetentionReview(demo.id, NOW)).toEqual({ candidates: 2, notified: 1 });
    expect(await runRetentionReview(demo.id, NOW)).toEqual({ candidates: 2, notified: 0 });
    const [mail] = await inDemo((tx) => tx.select().from(s.notifications).where(eq(s.notifications.kind, "retention_review")));
    expect(mail).toMatchObject({ userId: users.steward, subject: "Retention review: 2 people to keep or erase" });
  });
});

// ---------------------------------------------------------------------------------------------
// Members and roles
// ---------------------------------------------------------------------------------------------

describe("members and roles (BRD 5.3)", () => {
  it("invites, changes roles and removes, keeping a partner and refusing self-changes", async () => {
    expect(await inviteMember(steward(), "New.Analyst@demo-search.example.com", "account_lead", "New Analyst")).toBe("invited");
    expect(await inviteMember(steward(), "new.analyst@demo-search.example.com", "validator")).toBe("already");
    const invited = (await inDemo((tx) => listMembers(tx))).find((m) => m.email === "new.analyst@demo-search.example.com")!;
    expect(invited).toMatchObject({ role: "account_lead", status: "invited", name: "New Analyst" });
    const [invite] = await inDemo((tx) => tx.select().from(s.notifications).where(eq(s.notifications.kind, "invitation")));
    expect(invite!.toEmail).toBe("new.analyst@demo-search.example.com");

    const signIn = await resolveSignIn({ email: "new.analyst@demo-search.example.com" });
    expect(signIn.ok).toBe(true);
    expect((await buildContext(invited.userId, demo.id))?.role).toBe("account_lead");

    await inDemo(async (tx) => {
      await changeMemberRole(tx, steward(), invited.memberId, "validator");
      const members = await listMembers(tx);
      const onlyPartner = members.find((m) => m.role === "partner" && m.status === "active")!;
      await expect(changeMemberRole(tx, steward(), onlyPartner.memberId, "account_lead")).rejects.toThrow(/at least one partner/);
      await expect(removeMember(tx, steward(), onlyPartner.memberId)).rejects.toBeInstanceOf(MemberError);
      const self = members.find((m) => m.userId === users.steward)!;
      await expect(changeMemberRole(tx, steward(), self.memberId, "partner")).rejects.toThrow(/own role/);
      await removeMember(tx, steward(), invited.memberId);
      const actions = (await tx.select({ action: s.auditLog.action }).from(s.auditLog).where(eq(s.auditLog.entityId, invited.userId))).map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(["member.invited", "member.role_changed", "member.removed"]));
    });
    expect(await buildContext(invited.userId, demo.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Break-glass access
// ---------------------------------------------------------------------------------------------

describe("platform admin and break-glass access (BRD 5.3, 18.3)", () => {
  it("sees usage without data, and reads a workspace only read-only, for a while, with an audited reason", async () => {
    expect(await buildContext(users.platform)).toBeNull();
    const overview = await platformOverview(users.platform, NOW);
    expect(overview.map((w) => w.slug).sort()).toEqual(["demo-search-partners", "harbor-search-group"]);
    expect(overview.every((w) => !w.isMember && w.grant === null)).toBe(true);
    await expect(platformOverview(users.partner, NOW)).rejects.toThrow(/platform admin/);

    await expect(startBreakGlass(users.platform, demo.id, "short", 60, NOW)).rejects.toThrow(/10 to 500/);
    await expect(startBreakGlass(users.platform, demo.id, "Support ticket 4411: a missing signal", 45, NOW)).rejects.toThrow(/how long/);
    await expect(startBreakGlass(users.validator, demo.id, "Support ticket 4411: a missing signal", 60, NOW)).rejects.toThrow(/member/);

    const now = new Date();
    const { grantId, expiresAt } = await startBreakGlass(users.platform, demo.id, "Support ticket 4411: a missing signal", 30, now);
    expect(expiresAt.getTime() - now.getTime()).toBe(30 * 60_000);
    const ctx = await buildContext(users.platform, demo.id);
    expect(ctx).toMatchObject({ role: "account_lead", breakGlass: { grantId, reason: "Support ticket 4411: a missing signal" } });
    expect(ctx!.workspace.id).toBe(demo.id);
    expect(await buildContext(users.platform, harbor.id)).toBeNull();

    await inDemo(async (tx) => {
      const [started] = await tx.select().from(s.auditLog).where(eq(s.auditLog.action, "platform_admin.break_glass_started"));
      expect(started).toMatchObject({ actorKind: "platform_admin", actorUserId: users.platform, entityId: grantId });
      const [mail] = await tx.select().from(s.notifications).where(eq(s.notifications.kind, "break_glass"));
      expect(mail).toMatchObject({ userId: users.steward });
      expect(mail!.bodyText).toContain("Support ticket 4411");
    });

    await endBreakGlass(users.platform, grantId);
    expect(await buildContext(users.platform, demo.id)).toBeNull();
    await inDemo(async (tx) => expect(await tx.select().from(s.auditLog).where(eq(s.auditLog.action, "platform_admin.break_glass_ended"))).toHaveLength(1));
  });
});

// ---------------------------------------------------------------------------------------------
// Shadow run
// ---------------------------------------------------------------------------------------------

describe("shadow run (BRD 24.1)", () => {
  it("reports the workload, counts rejects by feed, and at go-live promotes the last 7 days and discards older", async () => {
    const actor = { workspaceId: harbor.id, userId: users.platform };
    const inHarbor = <T>(fn: (tx: Tx) => Promise<T>) => withWorkspace(harbor.id, fn);
    await inHarbor((tx) => startShadowRun(tx, actor, new Date(NOW.getTime() - 10 * DAY)));
    const [personId, otherId] = harbor.personIds as [string, string];
    const ids = await inHarbor(async (tx) => {
      const insert = async (personId: string, lane: "auto_confirm" | "review" | "weekly_batch", daysAgo: number, key: string, priority: 1 | 2 | 3) => {
        const [row] = await tx.insert(s.signals).values({ workspaceId: harbor.id, subjectType: "person", personId, type: lane === "auto_confirm" ? "person_left" : "person_award", headline: `Shadow ${key}`, foundAt: new Date(NOW.getTime() - daysAgo * DAY), foundBy: "ai_scan", confidence: "high", priority, lane, status: "shadow", dedupeKey: `shadow:${key}`, explanation: { shadow_run: true } }).returning({ id: s.signals.id });
        await tx.insert(s.signalSources).values({ workspaceId: harbor.id, signalId: row!.id, sourceType: lane === "auto_confirm" ? "sec_8k" : "google_alert" });
        return row!.id;
      };
      return {
        auto: await insert(personId, "auto_confirm", 2, "auto", 1),
        review: await insert(otherId, "review", 3, "review", 2),
        rejected: await insert(otherId, "review", 4, "rejected", 2),
        old: await insert(personId, "weekly_batch", 9, "old", 3),
      };
    });
    await inHarbor((tx) => rejectSignal(tx, { workspaceId: harbor.id, userId: users.harborPartner }, ids.rejected, "not_relevant", NOW));

    const report = await inHarbor((tx) => shadowReport(tx, harbor.id, NOW));
    expect(report).toMatchObject({ on: true, signals: 4, autoConfirmShare: 0.25 });
    // Ten days in, so two weeks: (2 review items x 1.5 + 1 batch item x 0.25) / 2 = 1.6 minutes a week.
    expect(report.projectedMinutesPerWeek).toBe(1.6);
    expect(report.goCriterionMet).toBe(true);
    expect(report.rejectByFeed.find((f) => f.sourceType === "google_alert")).toMatchObject({ signals: 3, rejected: 1 });

    const result = await inHarbor((tx) => promoteShadow(tx, actor, NOW));
    expect(result).toMatchObject({ promoted: 2, confirmed: 1, discarded: 1 });
    await inHarbor(async (tx) => {
      const rows = await tx.select({ id: s.signals.id, status: s.signals.status }).from(s.signals).where(inArray(s.signals.id, Object.values(ids)));
      const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
      expect(status).toEqual({ [ids.auto]: "confirmed", [ids.review]: "pending", [ids.rejected]: "rejected" });
      const [ws] = await tx.select({ flags: s.workspaces.flags, settings: s.workspaces.settings }).from(s.workspaces).where(eq(s.workspaces.id, harbor.id));
      expect((ws!.flags as Record<string, boolean>)["pipeline.shadow"]).toBe(false);
      expect((ws!.settings as { shadow: { final_report: { signals: number } } }).shadow.final_report.signals).toBe(4);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Topics and content library
// ---------------------------------------------------------------------------------------------

describe("topics and content library (BRD 14)", () => {
  it("keeps one topic list, and adds items by form or CSV only with known topics", async () => {
    await inDemo(async (tx) => {
      await expect(saveTopics(tx, partner(), [])).rejects.toBeInstanceOf(ContentError);
      await saveTopics(tx, partner(), ["CEO succession", "Board composition", "Family business"]);
      const vocabulary = ["CEO succession", "Board composition", "Family business"];
      await expect(addContentItem(tx, partner(), { title: "Paper", url: null, topics: ["Unknown topic"], publishedOn: null, description: null }, vocabulary)).rejects.toThrow(/Not in the topic list/);
      const id = await addContentItem(tx, partner(), { title: "Succession, done well", url: "https://example.com/paper", topics: ["ceo succession"], publishedOn: "2026-09-01", description: null }, vocabulary);
      const [item] = await tx.select().from(s.contentItems).where(eq(s.contentItems.id, id));
      expect(item!.topics).toEqual(["CEO succession"]);

      const csv = "title,url,topics,published_on\nFamily boards,https://example.com/a,Family business;Board composition,2026-08-01\n,https://example.com/b,CEO succession,2026-08-02\nBad date,,CEO succession,August\n";
      const { rows } = previewContent(csv, vocabulary);
      expect(rows.map((r) => r.issues.length)).toEqual([0, 1, 1]);
      expect(await commitContent(tx, partner(), rows, vocabulary)).toMatchObject({ created: 1, rejected: [{ rowNumber: 3 }, { rowNumber: 4 }] });
    });
  });
});
