/**
 * Every P0 adapter against its fixtures (BRD 23 M3), run in rolled-back transactions so the seed
 * other tests count is untouched. Covers idempotency, suppression, robots.txt, the credit guard
 * and the three-failures alert.
 */
import { and, eq, isNull, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, withSystem, withWorkspace, type Tx } from "@/db/client";
import * as s from "@/db/schema";
import { createCompany } from "@/domain/records";
import { addSuppression } from "@/domain/suppression";
import { mockHttp } from "@/ingest/http";
import { checkSourceHealth, context, FAILURE_ALERT_THRESHOLD, ingestFeed, runSource } from "@/ingest/run";
import { getAdapter } from "@/ingest/registry";
import type { WriteResult } from "@/ingest/write";
import { inRolledBackWorkspace, loadFixtures, type WorkspaceFixture } from "./helpers";
import { SEED_NOW } from "./env";

let demo: WorkspaceFixture;
let harbor: WorkspaceFixture;
beforeAll(async () => ({ demo, harbor } = await loadFixtures()));
afterAll(() => closeDatabase());

const NOW = new Date(SEED_NOW);
const fresh = (): WriteResult => ({ fetched: 0, created: 0, duplicates: 0, suppressed: 0 });
const feedOf = async (tx: Tx, type: (typeof s.feeds)["$inferSelect"]["sourceType"]) => (await tx.select().from(s.feeds).where(eq(s.feeds.sourceType, type)))[0]!;
const raw = (tx: Tx, type: string) => tx.select().from(s.rawItems).where(sql`${s.rawItems.sourceType} = ${type}`);
const mock = { mode: "mock" as const, now: () => NOW };

async function ingest(tx: Tx, type: (typeof s.feeds)["$inferSelect"]["sourceType"], options: Parameters<typeof ingestFeed>[5] = {}) {
  const result = fresh();
  const feed = await feedOf(tx, type);
  await ingestFeed(tx, demo.id, { ...feed, lastSuccessAt: null }, NOW, result, { ...mock, ...options });
  return result;
}

describe("SEC EDGAR 8-K Item 5.02 (BRD 8.2)", () => {
  it("stores every recent 5.02 filing once, with only the Item 5.02 text, and ignores other filings", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const first = await ingest(tx, "sec_8k");
      expect(first.created).toBe(10);
      const items = await raw(tx, "sec_8k");
      expect(items.every((i) => i.externalId.startsWith("sec:"))).toBe(true);
      expect(items.every((i) => /Item 5\.02/.test(i.bodyText ?? ""))).toBe(true);
      expect(items.some((i) => /SIGNATURES|Item 9\.01|Item 2\.02/.test(i.bodyText ?? ""))).toBe(false);
      expect(items.filter((i) => (i.payload as { form: string }).form === "8-K/A")).toHaveLength(1);
      expect(items.every((i) => i.url?.startsWith("https://www.sec.gov/Archives/edgar/data/"))).toBe(true);

      const again = await ingest(tx, "sec_8k");
      expect(again).toMatchObject({ created: 0, duplicates: 10 });
    });
  });

  it("resolves a missing CIK from the ticker file, and queues an ambiguous one", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const actor = { workspaceId: demo.id, userId: null, kind: "system" as const };
      const one = await createCompany(tx, actor, { name: "Lumerix Therapeutics", ticker: "LMRX", ownership: "public" }, { sourceType: "manual" });
      const two = await createCompany(tx, actor, { name: "Harlan Example Corp", ownership: "public" }, { sourceType: "manual" });
      await ingest(tx, "sec_8k");
      const [lumerix] = await tx.select().from(s.companies).where(eq(s.companies.id, one));
      expect(lumerix!.secCik).toBe("9900009001");
      const queued = await tx.select().from(s.queueItems).where(eq(s.queueItems.kind, "ambiguous_cik"));
      expect(queued.map((q) => (q.payload as { company_id: string }).company_id)).toContain(two);
    });
  });

  it("refuses live access without SEC_USER_AGENT, and says how to fix it", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const ctx = await context(demo.id, NOW, tx);
      const adapter = getAdapter("sec_8k", { mode: "live", http: { mode: "live", request: async () => ({ status: 200, headers: {}, text: "{}" }) } });
      const health = await adapter.healthCheck(ctx, await feedOf(tx, "sec_8k"));
      expect(health.ok).toBe(false);
      expect(health.message).toMatch(/SEC_USER_AGENT/);
    });
  });
});

describe("press release wires and Google Alerts (BRD 8.3, 8.4)", () => {
  it("stores 20 wire items with at most a 2,000-character excerpt and the link's host", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      expect((await ingest(tx, "press_wire")).created).toBe(20);
      const items = await raw(tx, "press_wire");
      expect(items.every((i) => (i.bodyText?.length ?? 0) <= 2000)).toBe(true);
      expect(items.some((i) => (i.payload as { link_host: string }).link_host?.endsWith(".example.com"))).toBe(true);
      expect(items.every((i) => i.publishedAt instanceof Date)).toBe(true);
    });
  });

  it("applies the feed's keyword filter", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const feed = await feedOf(tx, "press_wire");
      await tx.update(s.feeds).set({ config: { ...(feed.config as object), keywords: ["appoint"] } }).where(eq(s.feeds.id, feed.id));
      const result = await ingest(tx, "press_wire");
      expect(result.created).toBeGreaterThan(0);
      expect(result.created).toBeLessThan(20);
    });
  });

  it("stores 15 alerts with Google's redirect removed from every link", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      expect((await ingest(tx, "google_alert")).created).toBe(15);
      const items = await raw(tx, "google_alert");
      expect(items.every((i) => i.url && !i.url.includes("google.com"))).toBe(true);
      expect(items.every((i) => !/<b>|&lt;/.test(i.title ?? ""))).toBe(true);
    });
  });
});

describe("leadership pages (BRD 8.5)", () => {
  it("keeps a baseline first, then turns the four changed pages into diffs, then sees no change", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const first = await ingest(tx, "leadership_page");
      const baseline = await raw(tx, "leadership_page");
      expect(first.created).toBe(baseline.length);
      expect(baseline.every((i) => i.outcome === "irrelevant" && i.processedAt)).toBe(true);

      await ingest(tx, "leadership_page");
      const diffs = (await raw(tx, "leadership_page")).filter((i) => (i.payload as { kind: string }).kind === "diff");
      expect(diffs).toHaveLength(4);
      expect(diffs.every((d) => d.processedAt === null)).toBe(true);
      const changes = diffs.map((d) => d.payload as { added: string[]; removed: string[] });
      expect(changes.some((c) => c.removed.length > 0)).toBe(true);
      expect(changes.some((c) => c.added.some((l) => /Independent Director/.test(l)))).toBe(true);
      expect(changes.every((c) => ![...c.added, ...c.removed].some((l) => /Copyright|Home/.test(l)))).toBe(true);

      expect((await ingest(tx, "leadership_page")).created).toBe(0);
    });
  });

  it("skips a site whose robots.txt disallows the platform", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      await ingest(tx, "leadership_page");
      const items = await raw(tx, "leadership_page");
      expect(items.some((i) => i.url?.includes("thistlegate-construction"))).toBe(false);
    });
  });
});

describe("Apollo (BRD 8.1)", () => {
  it("raises three job changes, stores two guessed emails as guessed, and updates firmographics", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const before = await tx.select({ id: s.companies.id, n: s.companies.employeeCount }).from(s.companies).where(eq(s.companies.name, "Quarnell Systems, Inc."));
      await ingest(tx, "apollo");
      const changes = await raw(tx, "apollo");
      expect(changes).toHaveLength(3);
      expect(changes.map((c) => (c.payload as { kind: string }).kind).sort()).toEqual(["job_change_employer", "job_change_employer", "job_change_title"]);
      expect(changes.every((c) => c.processedAt === null)).toBe(true);

      const apolloGuessed = await tx
        .select({ id: s.fieldSources.entityId })
        .from(s.fieldSources)
        .innerJoin(s.roles, eq(s.roles.id, s.fieldSources.entityId))
        .where(and(eq(s.fieldSources.sourceType, "apollo"), eq(s.fieldSources.field, "business_email"), eq(s.roles.emailStatus, "guessed"), eq(s.fieldSources.confidence, "low")));
      expect(apolloGuessed.length).toBeGreaterThanOrEqual(2);

      const [after] = await tx.select({ n: s.companies.employeeCount, org: s.companies.apolloOrgId }).from(s.companies).where(eq(s.companies.id, before[0]!.id));
      expect(after!.n).toBe(Math.round(before[0]!.n! * 1.04));
      expect(after!.org).toMatch(/^apollo-org-/);

      const [usage] = await tx.select().from(s.usageCounters).where(eq(s.usageCounters.provider, "apollo"));
      expect(usage!.units).toBeGreaterThanOrEqual(30);
    });
  });

  it("stops the weekly sweep at the monthly credit cap, but not on-demand enrichment", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const [ws] = await tx.select().from(s.workspaces);
      const settings = ws!.settings as Record<string, unknown>;
      await tx.update(s.workspaces).set({ settings: { ...settings, apollo: { monthly_credit_cap: 5 } } }).where(eq(s.workspaces.id, demo.id));
      await expect(ingest(tx, "apollo")).rejects.toThrow(/credit cap of 5/);
    });
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const [ws] = await tx.select().from(s.workspaces);
      await tx.update(s.workspaces).set({ settings: { ...(ws!.settings as object), apollo: { monthly_credit_cap: 5 } } }).where(eq(s.workspaces.id, demo.id));
      const [someone] = await tx.select({ id: s.persons.id }).from(s.persons).innerJoin(s.roles, and(eq(s.roles.personId, s.persons.id), eq(s.roles.isPrimary, true))).where(like(s.roles.businessEmail, "%@%")).limit(1);
      await ingest(tx, "apollo", { apollo: { essential: true, personIds: [someone!.id] } });
      const audits = await tx.select().from(s.auditLog).where(eq(s.auditLog.action, "usage.alert_80"));
      expect(audits.length).toBeLessThanOrEqual(1);
    });
  });
});

describe("newsletter (BRD 8.6)", () => {
  it("creates interactions, applies the unsubscribe, ignores unknown readers, and adds a first-party interest", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const result = await ingest(tx, "newsletter");
      expect(result.created).toBe(11);
      const clicks = await tx.select().from(s.interactions).where(eq(s.interactions.provider, "newsletter"));
      const imported = clicks.filter((c) => c.externalId?.startsWith("newsletter:"));
      expect(imported.filter((c) => c.channel === "newsletter_click")).toHaveLength(5);
      expect(imported.filter((c) => c.channel === "newsletter_open")).toHaveLength(3);
      const optOut = await tx.select().from(s.consents).where(and(eq(s.consents.channel, "newsletter"), eq(s.consents.status, "opted_out")));
      expect(optOut).toHaveLength(1);
      const unmatched = await tx.select().from(s.rawItems).where(and(eq(s.rawItems.sourceType, "newsletter"), eq(s.rawItems.outcome, "irrelevant")));
      expect(unmatched).toHaveLength(2);
      const interests = await tx.select().from(s.personInterests).where(and(eq(s.personInterests.topic, "Board composition"), eq(s.personInterests.source, "first_party")));
      expect(interests.length).toBeGreaterThanOrEqual(1);
      expect((await tx.select().from(s.rawItems).where(and(eq(s.rawItems.sourceType, "newsletter"), isNull(s.rawItems.processedAt))))).toHaveLength(0);

      expect((await ingest(tx, "newsletter")).created).toBe(0);
    });
  });

  it("skips a suppressed reader before anything about them is stored", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const csv = "email,event,occurred_at,issue_title,link_url,topics\ngone@suppressed.example.com,click,2026-09-20T10:00:00Z,Issue,,CFO agenda\n";
      await addSuppression(tx, demo.id, "email", "gone@suppressed.example.com", "erasure");
      const result = await ingest(tx, "newsletter", { newsletterCsv: csv });
      expect(result).toMatchObject({ fetched: 1, suppressed: 1, created: 0 });
    });
  });
});

describe("health checks and failure tracking", () => {
  it("every configured source reports healthy in mock mode", async () => {
    const feedIds = await withWorkspace(demo.id, (tx) => tx.select({ id: s.feeds.id, type: s.feeds.sourceType }).from(s.feeds));
    for (const feed of feedIds) {
      const health = await checkSourceHealth(demo.id, feed.id, mock);
      expect(health, feed.type).toMatchObject({ ok: true });
    }
  });

  it("records three failed runs in a row and raises one alert", async () => {
    const failing = mockHttp(() => ({ status: 503, headers: {}, text: "Service unavailable" }));
    const feed = await withWorkspace(harbor.id, async (tx) => (await tx.select().from(s.feeds).where(eq(s.feeds.sourceType, "press_wire")))[0]!);
    try {
      for (let i = 0; i < FAILURE_ALERT_THRESHOLD; i++) {
        const run = await runSource(harbor.id, "press_wire", { http: failing, now: () => NOW });
        expect(run.feeds[0]).toMatchObject({ ok: false });
      }
      const [after] = await withWorkspace(harbor.id, (tx) => tx.select().from(s.feeds).where(eq(s.feeds.id, feed.id)));
      expect(after!.consecutiveFailures).toBe(FAILURE_ALERT_THRESHOLD);
      expect(after!.lastError).toMatch(/returned an error/);
      const alerts = await withWorkspace(harbor.id, (tx) => tx.select().from(s.auditLog).where(and(eq(s.auditLog.action, "source.failing"), eq(s.auditLog.entityId, feed.id))));
      expect(alerts).toHaveLength(1);

      const recovered = await runSource(harbor.id, "press_wire", mock);
      expect(recovered.feeds[0]).toMatchObject({ ok: true });
      const [healthy] = await withWorkspace(harbor.id, (tx) => tx.select().from(s.feeds).where(eq(s.feeds.id, feed.id)));
      expect(healthy!.consecutiveFailures).toBe(0);
    } finally {
      await withSystem("test", async (tx) => {
        await tx.delete(s.rawItems).where(eq(s.rawItems.workspaceId, harbor.id));
        await tx.update(s.feeds).set({ consecutiveFailures: 0, lastError: null, lastRunAt: null, lastSuccessAt: null }).where(eq(s.feeds.id, feed.id));
      });
    }
  });

  it("skips a source whose workspace flag is off", async () => {
    await withSystem("test", async (tx) => {
      const [ws] = await tx.select().from(s.workspaces).where(eq(s.workspaces.id, harbor.id));
      await tx.update(s.workspaces).set({ flags: { ...(ws!.flags as object), "source.alerts": false } }).where(eq(s.workspaces.id, harbor.id));
    });
    try {
      expect(await runSource(harbor.id, "google_alert", mock)).toMatchObject({ skipped: "flag_off" });
    } finally {
      await withSystem("test", async (tx) => {
        const [ws] = await tx.select().from(s.workspaces).where(eq(s.workspaces.id, harbor.id));
        await tx.update(s.workspaces).set({ flags: { ...(ws!.flags as object), "source.alerts": true } }).where(eq(s.workspaces.id, harbor.id));
      });
    }
  });

  it("Release 3 sources have mocks and refuse live use", async () => {
    await inRolledBackWorkspace(demo.id, async (tx) => {
      const ctx = await context(demo.id, NOW, tx);
      for (const key of ["licensed", "news_api", "warn", "job_postings"] as const) {
        const items = [];
        for await (const i of getAdapter(key, { mode: "mock", now: () => NOW }).fetch(ctx, await feedOf(tx, "sec_8k"), null)) items.push(i);
        expect(items).toEqual([]);
        expect((await getAdapter(key, { mode: "live" }).healthCheck(ctx, await feedOf(tx, "sec_8k"))).ok).toBe(false);
      }
    });
  });
});
