/**
 * The signal pipeline and validation, end to end on the fixtures: acceptance scenarios 1, 2, 3,
 * 7, 8, 9 and 10 (BRD 22.2), plus idempotency, lanes and the AI failure path.
 *
 * This file changes records (confirmations end roles), so it rebuilds the test database before
 * and after, and the other files still see the untouched seed.
 */
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiOutputError, type AiAdapter } from "@/ai/adapter";
import { createMockAi } from "@/ai/mock";
import { closeDatabase, withSystem, withWorkspace } from "@/db/client";
import * as s from "@/db/schema";
import { loadSeed } from "@/db/seed";
import { runSource } from "@/ingest/run";
import { addWorkingDays } from "@/lib/working-days";
import { raiseDerivedSignals } from "@/pipeline/derived";
import { processPending } from "@/pipeline/process";
import {
  approveBatch, canResearch, completeResearch, confirmSignal, markSpotCheck, MAX_RESEARCH_CYCLES, reenableAutoConfirm, rejectSignal, requestResearch,
  sampleSpotChecks, suspendedSourceTypes, ValidationError,
} from "@/pipeline/validation";
import { resetDatabase } from "../../scripts/migrate";
import { loadFixtures, type WorkspaceFixture } from "./helpers";
import { SEED_NOW, TEST_DATABASE_ENV } from "./env";

const NOW = new Date(SEED_NOW);
const clock = () => NOW;
let demo: WorkspaceFixture;
let actor: { workspaceId: string; userId: string };

async function rebuild() {
  await closeDatabase();
  await resetDatabase(TEST_DATABASE_ENV.DATABASE_MIGRATE_URL);
  await loadSeed(SEED_NOW);
}

async function drain(workspaceId: string, ai: AiAdapter = createMockAi(clock)) {
  for (let i = 0; i < 20; i++) if ((await processPending(workspaceId, { ai, now: clock })).remaining === 0) return;
  throw new Error("The pipeline did not drain.");
}

beforeAll(async () => {
  await rebuild();
  ({ demo } = await loadFixtures());
  actor = { workspaceId: demo.id, userId: demo.partnerUserId };
  for (const source of ["sec_8k", "press_wire", "google_alert", "leadership_page", "leadership_page", "apollo", "newsletter"] as const) {
    const run = await runSource(demo.id, source, { mode: "mock", now: clock });
    expect(run.feeds.every((f) => f.ok), source).toBe(true);
  }
  await drain(demo.id);
  await withWorkspace(demo.id, (tx) => raiseDerivedSignals(tx, demo.id, NOW));
}, 120_000);

afterAll(async () => {
  await rebuild();
  await closeDatabase();
}, 60_000);

const inDemo = <T>(fn: Parameters<typeof withWorkspace<T>>[1]) => withWorkspace(demo.id, fn);
const signalsWhere = (where: ReturnType<typeof and>) => inDemo((tx) => tx.select().from(s.signals).where(where));

describe("pipeline outcomes on the fixtures", () => {
  it("scenario 1: an SEC 8-K Item 5.02 departure of a tracked CFO is confirmed without review, ends the role, and creates a drafted P1 check-in due in 2 working days", async () => {
    const [signal] = await signalsWhere(and(eq(s.signals.type, "person_left"), sql`${s.signals.headline} like '%Chief Financial Officer of Quarnell%'`));
    expect(signal).toMatchObject({ status: "confirmed", lane: "auto_confirm", confidence: "high", priority: 1, validatedBy: null });
    const [role] = await inDemo((tx) => tx.select().from(s.roles).where(eq(s.roles.id, signal!.roleId!)));
    expect(role).toMatchObject({ status: "ended", titleNormalised: "CFO" });
    const [action] = await inDemo((tx) => tx.select().from(s.actions).where(eq(s.actions.signalId, signal!.id)));
    expect(action).toMatchObject({ type: "check_in", status: "drafted", personId: signal!.personId });
    expect(action!.dueAt.toISOString()).toBe(addWorkingDays(NOW, 2).toISOString());
    const drafts = await inDemo((tx) => tx.select().from(s.drafts).where(eq(s.drafts.actionId, action!.id)));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.body).toMatch(/^\[Mock draft\]/);
    expect(drafts[0]!.checkIssues).toEqual([]);
  });

  it("the 8-K/A amendment and the leadership page change merge into that signal instead of adding items", async () => {
    const [signal] = await signalsWhere(and(eq(s.signals.type, "person_left"), sql`${s.signals.headline} like '%Chief Financial Officer of Quarnell%'`));
    const sources = await inDemo((tx) => tx.select().from(s.signalSources).where(eq(s.signalSources.signalId, signal!.id)));
    expect(sources.map((x) => x.sourceType).sort()).toEqual(["leadership_page", "sec_8k", "sec_8k"]);
    const merged = await inDemo((tx) => tx.select({ n: count() }).from(s.rawItems).where(eq(s.rawItems.outcome, "signal_merged")));
    expect(merged[0]!.n).toBeGreaterThanOrEqual(2);
  });

  it("scenario 2: three wire items about one appointment are one signal with three sources and high confidence", async () => {
    const joined = await signalsWhere(and(eq(s.signals.type, "person_joined"), sql`${s.signals.headline} like '%joins Ashvale Dental Partners%'`));
    expect(joined).toHaveLength(1);
    expect(joined[0]!.confidence).toBe("high");
    const sources = await inDemo((tx) => tx.select().from(s.signalSources).where(eq(s.signalSources.signalId, joined[0]!.id)));
    expect(sources).toHaveLength(3);
    expect(sources.every((x) => x.sourceType === "press_wire")).toBe(true);
  });

  it("scenario 3: a Google Alert about someone else with a tracked executive's name, and no tracked company, creates nothing", async () => {
    const falseMatches = await inDemo((tx) => tx.select().from(s.rawItems).where(and(eq(s.rawItems.sourceType, "google_alert"), sql`${s.rawItems.title} like '%Westfield High%' or ${s.rawItems.title} like '%painter%'`)));
    expect(falseMatches).toHaveLength(2);
    expect(falseMatches.every((r) => r.outcome === "irrelevant")).toBe(true);
    const fromThem = await inDemo((tx) => tx.select({ n: count() }).from(s.signalSources).where(inArray(s.signalSources.rawItemId, falseMatches.map((r) => r.id))));
    expect(fromThem[0]!.n).toBe(0);
  });

  it("puts signals in every lane, and never leaves an item unprocessed or in error", async () => {
    const lanes = await inDemo((tx) => tx.selectDistinct({ lane: s.signals.lane }).from(s.signals));
    expect(lanes.map((l) => l.lane).sort()).toEqual(["auto_confirm", "review", "weekly_batch"]);
    const open = await inDemo((tx) => tx.select({ n: count() }).from(s.rawItems).where(isNull(s.rawItems.processedAt)));
    expect(open[0]!.n).toBe(0);
    const errors = await inDemo((tx) => tx.select({ n: count() }).from(s.rawItems).where(eq(s.rawItems.outcome, "error")));
    expect(errors[0]!.n).toBe(0);
  });

  it("an announced move is auto-confirmed as an announced role, with the action due 2 working days before the start", async () => {
    const [signal] = await signalsWhere(eq(s.signals.type, "person_move_announced"));
    expect(signal!.status).toBe("confirmed");
    const newRoles = await inDemo((tx) => tx.select().from(s.roles).where(and(eq(s.roles.personId, signal!.personId!), eq(s.roles.status, "announced"))));
    expect(newRoles).toHaveLength(1);
    const [action] = await inDemo((tx) => tx.select().from(s.actions).where(eq(s.actions.signalId, signal!.id)));
    expect(action!.dueAt.toISOString()).toBe(addWorkingDays(new Date(`${signal!.effectiveOn}T12:00:00Z`), -2).toISOString());
  });

  it("scenario 6 (completion): on the effective date the announced role becomes current", async () => {
    const { runRecordsStatus } = await import("@/jobs/handlers");
    const [signal] = await signalsWhere(eq(s.signals.type, "person_move_announced"));
    await runRecordsStatus(demo.id, signal!.effectiveOn!);
    const roles = await inDemo((tx) => tx.select().from(s.roles).where(and(eq(s.roles.personId, signal!.personId!), eq(s.roles.companyId, signal!.companyId!))));
    expect(roles.find((r) => r.titleNormalised === "CFO")!.status).toBe("current");
  });

  it("Apollo changes: a move to a tracked company goes to review; a move off the list is priority 2 and flags the person", async () => {
    const apollo = await inDemo((tx) => tx.select({ signal: s.signals }).from(s.signals).innerJoin(s.signalSources, eq(s.signalSources.signalId, s.signals.id)).where(eq(s.signalSources.sourceType, "apollo")));
    expect(apollo).toHaveLength(3);
    expect(apollo.every((a) => a.signal.lane === "review")).toBe(true);
    const offList = apollo.find((a) => (a.signal.proposedChanges as { kind: string }[]).some((c) => c.kind === "set_off_list"));
    expect(offList!.signal.priority).toBe(2);
  });

  it("rule-raised signals (CEO tenure, first-party interest) wait in the weekly batch", async () => {
    const derived = await signalsWhere(inArray(s.signals.type, ["company_ceo_tenure_threshold", "person_content_engagement"]));
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.every((d) => d.lane === "weekly_batch" && d.priority === 3)).toBe(true);
    expect(derived.some((d) => d.type === "person_content_engagement")).toBe(true);
  });

  it("is idempotent: ingesting and processing again creates nothing new", async () => {
    const before = await inDemo((tx) => tx.select({ n: count() }).from(s.signals));
    for (const source of ["sec_8k", "press_wire", "google_alert"] as const) await runSource(demo.id, source, { mode: "mock", now: clock });
    await drain(demo.id);
    await withWorkspace(demo.id, (tx) => raiseDerivedSignals(tx, demo.id, NOW));
    const after = await inDemo((tx) => tx.select({ n: count() }).from(s.signals));
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});

describe("validation", () => {
  it("scenario 7: rejecting a pending P2 signal as wrong person stores the reason and adds to the feed's weekly reject count", async () => {
    const [signal] = await signalsWhere(and(eq(s.signals.priority, 2), eq(s.signals.status, "pending"), sql`exists (select 1 from dmi.signal_sources ss where ss.signal_id = ${s.signals.id} and ss.source_type = 'press_wire')`));
    const feedRejects = async () =>
      inDemo(async (tx) => {
        const [feed] = await tx.select().from(s.feeds).where(eq(s.feeds.sourceType, "press_wire"));
        const rows = await tx.select().from(s.sourceStatsWeekly).where(eq(s.sourceStatsWeekly.feedId, feed!.id));
        return rows.reduce((n, r) => n + r.rejected, 0);
      });
    const before = await feedRejects();
    await inDemo((tx) => rejectSignal(tx, actor, signal!.id, "wrong_person", NOW));
    const [after] = await signalsWhere(eq(s.signals.id, signal!.id));
    expect(after).toMatchObject({ status: "rejected", rejectReason: "wrong_person", validatedBy: demo.partnerUserId });
    expect(await feedRejects()).toBe(before + 1);
    await expect(inDemo((tx) => rejectSignal(tx, actor, signal!.id, "duplicate", NOW))).rejects.toBeInstanceOf(ValidationError);
  });

  it("scenario 8: after two research cycles, only confirm, reject and park remain", async () => {
    const [signal] = await signalsWhere(and(eq(s.signals.status, "pending"), eq(s.signals.lane, "review"), eq(s.signals.confidence, "low")));
    for (let cycle = 1; cycle <= MAX_RESEARCH_CYCLES; cycle++) {
      await inDemo((tx) => requestResearch(tx, actor, signal!.id));
      const result = await completeResearch(demo.id, signal!.id, { ai: createMockAi(clock), now: clock });
      expect(result.verdict).toBe("confirms");
    }
    const [after] = await signalsWhere(eq(s.signals.id, signal!.id));
    expect(after).toMatchObject({ status: "pending", lane: "review", researchCycles: 2 });
    expect(canResearch(after!)).toBe(false);
    expect(after!.researchNotes).toHaveLength(2);
    await expect(inDemo((tx) => requestResearch(tx, actor, signal!.id))).rejects.toThrow(/two research cycles/);
    const sources = await inDemo((tx) => tx.select().from(s.signalSources).where(and(eq(s.signalSources.signalId, signal!.id), eq(s.signalSources.sourceType, "ai_research"))));
    expect(sources.length).toBeGreaterThanOrEqual(1);
  });

  it("scenario 9: approving a weekly batch of 12 with one unticked confirms 11 and leaves one pending", async () => {
    const ids = await inDemo(async (tx) => {
      const [company] = await tx.select().from(s.companies).limit(1);
      const rows = [];
      for (let i = 0; i < 12; i++) {
        const [row] = await tx
          .insert(s.signals)
          .values({ workspaceId: demo.id, subjectType: "company", companyId: company!.id, type: "company_product_partnership", headline: `Batch test ${i}`, foundAt: NOW, foundBy: "team_member", confidence: "medium", priority: 3, lane: "weekly_batch", status: "pending", dedupeKey: `batch-test-${i}` })
          .returning({ id: s.signals.id });
        rows.push(row!.id);
      }
      return rows;
    });
    const unticked = ids[5]!;
    const result = await inDemo((tx) => approveBatch(tx, actor, ids.filter((id) => id !== unticked), NOW));
    expect(result.confirmed).toBe(11);
    const rows = await signalsWhere(inArray(s.signals.id, ids));
    expect(rows.filter((r) => r.status === "confirmed")).toHaveLength(11);
    expect(rows.find((r) => r.id === unticked)!.status).toBe("pending");
    const audits = await inDemo((tx) => tx.select({ n: count() }).from(s.auditLog).where(and(eq(s.auditLog.action, "signal.confirmed"), inArray(s.auditLog.entityId, ids))));
    expect(audits[0]!.n).toBe(11);
  });

  it("scenario 10: one incorrect spot check in five suspends SEC auto-confirm, and new SEC items then go to review", async () => {
    const lastWeek = new Date(NOW.getTime() - 7 * 86_400_000);
    const ids = await inDemo(async (tx) => {
      const [company] = await tx.select().from(s.companies).where(sql`${s.companies.secCik} is not null`).limit(1);
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const [row] = await tx
          .insert(s.signals)
          .values({ workspaceId: demo.id, subjectType: "company", companyId: company!.id, type: "company_cxo_change", headline: `Spot test ${i}`, foundAt: lastWeek, foundBy: "ai_scan", confidence: "high", priority: 1, lane: "auto_confirm", status: "confirmed", confirmedAt: lastWeek, validatedAt: lastWeek, dedupeKey: `spot-test-${i}` })
          .returning({ id: s.signals.id });
        await tx.insert(s.signalSources).values({ workspaceId: demo.id, signalId: row!.id, sourceType: "sec_8k", url: `https://www.sec.gov/example/${i}` });
        rows.push(row!.id);
      }
      return rows;
    });
    expect(await inDemo((tx) => sampleSpotChecks(tx, demo.id, NOW))).toBe(5);
    expect(await inDemo((tx) => sampleSpotChecks(tx, demo.id, NOW))).toBe(0);
    for (const id of ids.slice(0, 4)) expect(await inDemo((tx) => markSpotCheck(tx, actor, id, "correct", NOW))).toEqual([]);
    expect(await inDemo((tx) => markSpotCheck(tx, actor, ids[4]!, "incorrect", NOW))).toEqual(["sec_8k"]);
    const [ws] = await inDemo((tx) => tx.select().from(s.workspaces));
    expect(suspendedSourceTypes(ws!.settings as Record<string, unknown>).map((x) => x.sourceType)).toEqual(["sec_8k"]);

    // With SEC suspended, a new primary-source SEC item waits for review instead of confirming.
    await withSystem("test", (tx) => tx.execute(sql`update dmi.raw_items set processed_at = null, outcome = null where workspace_id = ${demo.id} and external_id = (select external_id from dmi.raw_items where workspace_id = ${demo.id} and source_type = 'sec_8k' and title like '%Penhallow%' limit 1)`));
    await withSystem("test", (tx) => tx.execute(sql`delete from dmi.signal_sources where workspace_id = ${demo.id} and raw_item_id in (select id from dmi.raw_items where workspace_id = ${demo.id} and processed_at is null)`));
    const tams = await signalsWhere(sql`${s.signals.headline} like '%Penhallow Financial plc appoints%' and ${s.signals.type} = 'company_cxo_change'`);
    await withSystem("test", (tx) => tx.delete(s.actions).where(inArray(s.actions.signalId, tams.map((t) => t.id))));
    await withSystem("test", (tx) => tx.delete(s.signals).where(inArray(s.signals.id, tams.map((t) => t.id))));
    await drain(demo.id);
    const [again] = await signalsWhere(sql`${s.signals.headline} like '%Penhallow Financial plc appoints%' and ${s.signals.type} = 'company_cxo_change'`);
    expect(again).toMatchObject({ lane: "review", status: "pending" });

    await inDemo((tx) => reenableAutoConfirm(tx, actor, "sec_8k"));
    const [ws2] = await inDemo((tx) => tx.select().from(s.workspaces));
    expect(suspendedSourceTypes(ws2!.settings as Record<string, unknown>)).toEqual([]);
  });

  it("confirming with edits records the override and applies the proposed record changes", async () => {
    const [signal] = await signalsWhere(and(eq(s.signals.type, "person_promotion"), eq(s.signals.status, "pending"), sql`jsonb_array_length(${s.signals.proposedChanges}) > 0`));
    await inDemo((tx) => confirmSignal(tx, actor, signal!.id, { now: NOW, edits: { headline: "Edited by the validator", confidence: "high" } }));
    const [after] = await signalsWhere(eq(s.signals.id, signal!.id));
    expect(after).toMatchObject({ status: "confirmed", headline: "Edited by the validator", confidence: "high" });
    const newRole = await inDemo((tx) => tx.select().from(s.roles).where(and(eq(s.roles.personId, signal!.personId!), eq(s.roles.status, "current"))));
    const change = (signal!.proposedChanges as { kind: string; title?: string }[]).find((c) => c.kind === "add_role");
    expect(newRole.some((r) => r.title === change!.title)).toBe(true);
  });
});

describe("AI failure", () => {
  it("an item the AI cannot read after its retry goes to review with a note", async () => {
    const failing: AiAdapter = {
      ...createMockAi(clock),
      mode: "mock",
      async extractSignal() {
        throw new AiOutputError("AI could not read this item", { purpose: "extract_signal", model: "test", promptVersion: "extract.v1", inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, status: "error", error: "invalid" });
      },
    };
    await withSystem("test", (tx) => tx.execute(sql`update dmi.raw_items set processed_at = null, outcome = null where workspace_id = ${demo.id} and source_type = 'press_wire' and title like '%Expands Into Europe%'`));
    await drain(demo.id, failing);
    const [signal] = await signalsWhere(sql`${s.signals.headline} like 'Needs reading:%'`);
    expect(signal).toMatchObject({ type: "other", lane: "review", status: "pending" });
    expect((signal!.explanation as { note: string }).note).toBe("AI could not read this item");
    const calls = await inDemo((tx) => tx.select().from(s.aiCalls).where(eq(s.aiCalls.status, "error")));
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });
});
