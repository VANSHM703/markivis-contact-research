/**
 * The executive search pack (BRD 13), milestone M6's definition of done: the pack toggles cleanly
 * on and off. With it on: off-limits blocks candidate approaches, placed executives are priority 1
 * and their leaving creates a backfill check-in, CEO tenure raises a succession signal, mandate
 * notes are partner-only, audited and never sent to the AI, and the imports work. With it off,
 * each of those is skipped.
 *
 * Changes commit across transactions, so the test database is rebuilt before and after.
 */
import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiAdapter } from "@/ai/adapter";
import type { DraftInput } from "@/ai/contracts";
import { createMockAi } from "@/ai/mock";
import { closeDatabase, withSystem, withWorkspace, type Tx } from "@/db/client";
import * as s from "@/db/schema";
import { loadSeed } from "@/db/seed";
import { createActionForSignal, createManualAction, draftForAction } from "@/domain/actions";
import { evaluateChecks, loadCheckFacts } from "@/domain/checks";
import { commitPack, previewPack, readPackFile } from "@/domain/imports/pack";
import { addMandateNote, readMandateNotes } from "@/domain/mandate-notes";
import { addOffLimitsRule, endOffLimitsRule, offLimitsCoversSql, rulesEndingSoon } from "@/domain/off-limits";
import { runDigest } from "@/digest/digest";
import { ForbiddenError } from "@/lib/permissions";
import { raiseDerivedSignals } from "@/pipeline/derived";
import { priorityOf } from "@/pipeline/rules";
import { resetDatabase } from "../../scripts/migrate";
import { loadFixtures, type WorkspaceFixture } from "./helpers";
import { SEED_NOW, TEST_DATABASE_ENV } from "./env";

const NOW = new Date(SEED_NOW);
const TODAY = "2026-09-30";
let demo: WorkspaceFixture;
let harbor: WorkspaceFixture;
type Role = (typeof s.workspaceMembers.$inferSelect)["role"];
const actors = {} as Record<"partner" | "outreach_owner" | "validator", { workspaceId: string; userId: string; role: Role }>;

async function rebuild() {
  await closeDatabase();
  await resetDatabase(TEST_DATABASE_ENV.DATABASE_MIGRATE_URL);
  await loadSeed(SEED_NOW);
}
const inDemo = <T>(fn: (tx: Tx) => Promise<T>) => withWorkspace(demo.id, fn);

async function setPack(workspaceId: string, on: boolean) {
  await withSystem("test", (tx) =>
    tx.update(s.workspaces).set({ packs: sql`jsonb_set(${s.workspaces.packs}, '{exec_search}', ${on ? sql`'true'` : sql`'false'`}::jsonb)`, flags: sql`jsonb_set(${s.workspaces.flags}, '{pack.exec_search}', ${on ? sql`'true'` : sql`'false'`}::jsonb)` }).where(eq(s.workspaces.id, workspaceId)),
  );
}

/** An executive at the company-wide off-limits client (Wexcombe Group in the seed). */
async function offLimitsExec() {
  const [row] = await inDemo((tx) =>
    tx
      .select({ personId: s.roles.personId, companyId: s.roles.companyId })
      .from(s.offLimits)
      .innerJoin(s.roles, and(eq(s.roles.companyId, s.offLimits.companyId), eq(s.roles.status, "current"), eq(s.roles.seatType, "executive")))
      .where(eq(s.offLimits.scope, "company"))
      .limit(1),
  );
  return row!;
}

async function leftSignal(tx: Tx, personId: string, companyId: string, roleId: string) {
  const [signal] = await tx
    .insert(s.signals)
    .values({
      workspaceId: demo.id, subjectType: "person", personId, companyId, roleId, type: "person_left", headline: "A placed executive steps down", foundBy: "feed_rule",
      confidence: "high", priority: 1, lane: "review", status: "confirmed", confirmedAt: NOW, dedupeKey: `test:${personId}:${Math.random()}`,
      proposedChanges: [{ kind: "end_role", role_id: roleId, person_id: personId, company_id: companyId, title: "Chief Financial Officer", ended_on: TODAY }],
    })
    .returning();
  return signal!;
}

beforeAll(async () => {
  await rebuild();
  ({ demo, harbor } = await loadFixtures());
  const members = await withSystem("test", (tx) => tx.select({ userId: s.workspaceMembers.userId, role: s.workspaceMembers.role }).from(s.workspaceMembers).where(eq(s.workspaceMembers.workspaceId, demo.id)));
  for (const role of ["partner", "outreach_owner", "validator"] as const) actors[role] = { workspaceId: demo.id, userId: members.find((m) => m.role === role)!.userId, role };
}, 120_000);

afterAll(async () => {
  await rebuild();
  await closeDatabase();
}, 60_000);

describe("the pack toggles cleanly on and off", () => {
  it("seeds the first workspace with the pack on and the second with it off", async () => {
    const rows = await withSystem("test", (tx) => tx.select({ slug: s.workspaces.slug, packs: s.workspaces.packs }).from(s.workspaces));
    expect(rows.find((r) => r.slug === demo.slug)!.packs).toMatchObject({ exec_search: true });
    expect(rows.find((r) => r.slug === harbor.slug)!.packs).toMatchObject({ exec_search: false });
  });

  it("off-limits blocks a candidate approach only while the pack is on", async () => {
    const exec = await offLimitsExec();
    const check = async () => {
      const facts = await inDemo((tx) => loadCheckFacts(tx, demo.id, exec.personId));
      return evaluateChecks(facts!, "candidate", TODAY).kind;
    };
    expect(await check()).toBe("blocked");
    await setPack(demo.id, false);
    expect(await check()).toBe("ok");
    await setPack(demo.id, true);
    expect(await check()).toBe("blocked");
  });

  it("succession watch raises CEO tenure signals only with the pack on", async () => {
    const tenure = () => inDemo(async (tx) => (await tx.select({ n: count() }).from(s.signals).where(eq(s.signals.type, "company_ceo_tenure_threshold")))[0]!.n);
    await setPack(demo.id, false);
    await inDemo((tx) => raiseDerivedSignals(tx, demo.id, NOW));
    expect(await tenure()).toBe(0);
    await setPack(demo.id, true);
    await inDemo((tx) => raiseDerivedSignals(tx, demo.id, NOW));
    expect(await tenure()).toBeGreaterThan(0);
  });

  it("a placed executive's move is priority 1 (the pipeline applies the override only with the pack on)", () => {
    expect(priorityOf({ type: "person_promotion", personIsPlaced: true, offList: false }).priority).toBe(1);
    expect(priorityOf({ type: "person_promotion", personIsPlaced: false, offList: false }).priority).toBe(2);
  });
});

describe("placements (BRD 13)", () => {
  it("a placed executive leaving creates a check-in with them and a backfill check-in with the most senior person at the company they left; none with the pack off", async () => {
    const [placed] = await inDemo((tx) =>
      tx
        .select({ personId: s.placements.personId, roleId: s.roles.id, companyId: s.roles.companyId })
        .from(s.placements)
        .innerJoin(s.roles, and(eq(s.roles.personId, s.placements.personId), eq(s.roles.status, "current"), eq(s.roles.seatType, "executive")))
        .innerJoin(s.persons, eq(s.persons.id, s.placements.personId))
        .where(and(eq(s.persons.status, "active"), sql`${s.persons.country} is distinct from 'DE'`))
        .limit(1),
    );
    expect(placed, "the seed has a placed executive in a current role").toBeTruthy();

    await setPack(demo.id, false);
    const off = await inDemo(async (tx) => createActionForSignal(tx, await leftSignal(tx, placed!.personId, placed!.companyId, placed!.roleId), NOW));
    expect(off?.also).toBeUndefined();
    await inDemo((tx) => tx.delete(s.actions).where(eq(s.actions.personId, placed!.personId)));
    await setPack(demo.id, true);

    const created = await inDemo(async (tx) => createActionForSignal(tx, await leftSignal(tx, placed!.personId, placed!.companyId, placed!.roleId), NOW));
    expect(created).toBeTruthy();
    expect(created!.also).toHaveLength(1);
    const [backfill] = await inDemo((tx) => tx.select().from(s.actions).where(eq(s.actions.id, created!.also![0]!.actionId)));
    expect(backfill!.personId).not.toBe(placed!.personId);
    expect(backfill!.companyId).toBe(placed!.companyId);
    expect(backfill!.headline).toMatch(/^Possible backfill search at /);
    const [role] = await inDemo((tx) => tx.select().from(s.roles).where(and(eq(s.roles.personId, backfill!.personId!), eq(s.roles.companyId, placed!.companyId), eq(s.roles.status, "current"))));
    expect(role, "the backfill contact works at the company that was left").toBeTruthy();
  });

  it("imports placements: matches people, creates new ones with the placed role, skips repeats and reports errors", async () => {
    const [known] = await inDemo((tx) =>
      tx.select({ name: s.persons.fullName, email: s.roles.businessEmail, company: s.companies.name }).from(s.persons).innerJoin(s.roles, and(eq(s.roles.personId, s.persons.id), eq(s.roles.isPrimary, true))).innerJoin(s.companies, eq(s.companies.id, s.roles.companyId)).where(sql`${s.roles.businessEmail} is not null and not exists (select 1 from dmi.placements p where p.person_id = ${s.persons.id})`).limit(1),
    );
    const csv = [
      "person_full_name,company_name,role_title,placed_on,person_email,search_reference",
      `${known!.name},${known!.company},Chief Financial Officer,2023-05-01,${known!.email},DSP-2023-001`,
      "Morgan Placeholder,Newfield Example Industries,Chief People Officer,2024-02-12,,DSP-2024-002",
      "Missing Date,Example Co,CEO,,,",
      `${known!.name},${known!.company},Chief Financial Officer,2023-05-01,${known!.email},DSP-2023-001`,
    ].join("\n");
    const { rows, unknownColumns } = readPackFile("placements", csv);
    const preview = await inDemo((tx) => previewPack(tx, demo.id, "placements", rows, unknownColumns));
    expect(preview.rows.map((r) => r.outcome ?? "invalid")).toEqual(["matched", "new_person", "invalid", "matched"]);
    expect(preview.rows[2]!.issues[0]!.column).toBe("placed_on");
    const report = await inDemo((tx) => commitPack(tx, actors.partner, "placements", "00000000-0000-4000-8000-000000000001", preview.rows, { sourceType: "manual", note: "Firm records", sourceUrl: null }));
    expect(report).toMatchObject({ placementsCreated: 2, peopleCreated: 1, peopleMatched: 2, skipped: 1 });
    expect(report.rejected).toHaveLength(1);
    const [newbie] = await inDemo((tx) => tx.select({ id: s.persons.id }).from(s.persons).where(eq(s.persons.fullName, "Morgan Placeholder")));
    const [pl] = await inDemo((tx) => tx.select().from(s.placements).where(eq(s.placements.personId, newbie!.id)));
    expect(pl).toMatchObject({ roleTitle: "Chief People Officer", placedOn: "2024-02-12", searchReference: "DSP-2024-002" });
  });
});

describe("off-limits rules (BRD 13)", () => {
  it("only a partner adds rules; ending one stops it applying; badges use the same test as the checks", async () => {
    const [company] = await inDemo((tx) => tx.select({ id: s.companies.id }).from(s.companies).where(sql`not exists (select 1 from dmi.off_limits o where o.company_id = ${s.companies.id}) and exists (select 1 from dmi.roles r where r.company_id = ${s.companies.id} and r.status = 'current' and r.seniority = 'c_suite' and r.seat_type = 'executive')`).limit(1));
    const [exec] = await inDemo((tx) => tx.select({ personId: s.roles.personId }).from(s.roles).where(and(eq(s.roles.companyId, company!.id), eq(s.roles.status, "current"), eq(s.roles.seniority, "c_suite"), eq(s.roles.seatType, "executive"))).limit(1));
    const covered = () => inDemo(async (tx) => (await tx.select({ c: offLimitsCoversSql(sql`${exec!.personId}::uuid`, TODAY) }).from(sql`(select 1) as one`))[0]!.c);
    const input = { companyId: company!.id, scope: "level_and_above" as const, function: null, minSeniority: "svp" as const, reason: "contractual" as const, startsOn: "2026-09-01", endsOn: null };

    await expect(inDemo((tx) => addOffLimitsRule(tx, actors.outreach_owner, input))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await covered()).toBe(false);
    const ruleId = await inDemo((tx) => addOffLimitsRule(tx, actors.partner, input));
    expect(await covered()).toBe(true);
    const facts = await inDemo((tx) => loadCheckFacts(tx, demo.id, exec!.personId));
    expect(evaluateChecks(facts!, "candidate", TODAY).kind).toBe("blocked");
    await inDemo((tx) => endOffLimitsRule(tx, actors.partner, ruleId, TODAY));
    expect(await covered()).toBe(false);
    const [audit] = await inDemo((tx) => tx.select({ n: count() }).from(s.auditLog).where(sql`${s.auditLog.action} in ('off_limits.added', 'off_limits.ended')`));
    expect(audit!.n).toBeGreaterThanOrEqual(2);
  });

  it("imports rules for companies on the list and rejects unknown companies", async () => {
    const [company] = await inDemo((tx) => tx.select({ name: s.companies.name }).from(s.companies).where(eq(s.companies.isSponsor, false)).limit(1));
    const csv = ["company_name,scope,function,reason,starts_on,ends_on", `${company!.name},function,Technology,recent_placement,2026-01-01,2027-12-31`, "Nobody Heard Of Inc,company,,current_client,2026-01-01,", `${company!.name},function,,contractual,2026-01-01,`].join("\n");
    const { rows } = readPackFile("off_limits", csv);
    const preview = await inDemo((tx) => previewPack(tx, demo.id, "off_limits", rows, []));
    expect(preview.rows.map((r) => r.issues.map((i) => i.column))).toEqual([[], ["company_name"], ["function"]]);
    const report = await inDemo((tx) => commitPack(tx, actors.partner, "off_limits", "00000000-0000-4000-8000-000000000002", preview.rows, { sourceType: "manual", note: "Engagement letters", sourceUrl: null }));
    expect(report.rulesCreated).toBe(1);
    expect(report.rejected).toHaveLength(2);
  });

  it("reminds the partner once in the digest, 30 days before a rule ends", async () => {
    expect((await inDemo((tx) => rulesEndingSoon(tx, TODAY))).length).toBeGreaterThanOrEqual(1);
    const mailer = { mode: "mock" as const, send: async () => ({ messageId: "m" }) };
    await runDigest(demo.id, { now: NOW, mailer });
    const [digest] = await inDemo((tx) => tx.select().from(s.notifications).where(and(eq(s.notifications.kind, "digest"), eq(s.notifications.userId, actors.partner.userId))));
    expect(digest!.bodyText).toContain("Off-limits rules ending within 30 days (1)");
    const [validatorDigest] = await inDemo((tx) => tx.select().from(s.notifications).where(and(eq(s.notifications.kind, "digest"), eq(s.notifications.userId, actors.validator.userId))));
    expect(validatorDigest?.bodyText ?? "").not.toContain("Off-limits");
  });
});

describe("confidential mandate notes (BRD 13)", () => {
  it("are partner only, every read is audited, and a draft never receives them", async () => {
    const exec = await offLimitsExec();
    await expect(inDemo((tx) => readMandateNotes(tx, actors.outreach_owner, { personId: exec.personId }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inDemo((tx) => addMandateNote(tx, actors.validator, { personId: exec.personId }, "x y"))).rejects.toBeInstanceOf(ForbiddenError);
    const secret = "Board wants a quiet succession plan; compensation ceiling 1.2m.";
    await inDemo((tx) => addMandateNote(tx, actors.partner, { personId: exec.personId }, secret));
    const notes = await inDemo((tx) => readMandateNotes(tx, actors.partner, { personId: exec.personId }));
    expect(notes.map((n) => n.body)).toContain(secret);
    const [viewed] = await inDemo((tx) => tx.select({ n: count() }).from(s.auditLog).where(and(eq(s.auditLog.action, "mandate_notes.viewed"), eq(s.auditLog.entityId, exec.personId))));
    expect(viewed!.n).toBe(1);
    const [created] = await inDemo((tx) => tx.select({ after: s.auditLog.after }).from(s.auditLog).where(and(eq(s.auditLog.action, "mandate_note.created"), eq(s.auditLog.entityId, exec.personId))));
    expect(JSON.stringify(created!.after)).not.toContain("succession");

    // Draft a client check-in for the same person and capture everything the AI is given.
    let seen: DraftInput | null = null;
    const mock = createMockAi(() => NOW);
    const spy: AiAdapter = { ...mock, draftMessage: async (input) => ((seen = input), mock.draftMessage(input)) };
    const action = await inDemo((tx) => createManualAction(tx, actors.partner, { personId: exec.personId, type: "check_in", purpose: "client", ownerUserId: actors.partner.userId, dueAt: new Date(NOW.getTime() + 86_400_000) }));
    expect(await draftForAction(demo.id, (action as { actionId: string }).actionId, { ai: spy, now: () => NOW })).toMatchObject({ kind: "drafted" });
    expect(seen).not.toBeNull();
    expect(JSON.stringify(seen)).not.toContain("succession plan");
    expect(seen!.approach).toBe("client");
  });
});
