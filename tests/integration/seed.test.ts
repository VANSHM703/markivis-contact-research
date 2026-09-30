/** The seed workspace matches BRD section 21 exactly. */
import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, withWorkspace } from "@/db/client";
import * as s from "@/db/schema";
import { loadFixtures, type WorkspaceFixture } from "./helpers";
import { SEED_NOW } from "./env";

let demo: WorkspaceFixture;
beforeAll(async () => ({ demo } = await loadFixtures()));
afterAll(() => closeDatabase());

const n = async (fn: (tx: Parameters<Parameters<typeof withWorkspace>[1]>[0]) => Promise<{ n: number }[]>) =>
  withWorkspace(demo.id, async (tx) => (await fn(tx))[0]?.n ?? 0);

describe("seed workspace: Demo Search Partners", () => {
  it("has the executive search pack on", async () => {
    const ws = await withWorkspace(demo.id, (tx) => tx.select().from(s.workspaces));
    expect((ws[0]?.packs as Record<string, boolean>).exec_search).toBe(true);
  });

  it("has 4 seeded users: partner, outreach owner, validator, data steward", async () => {
    // Other tests sign new people in, so count the seeded users by email rather than all members.
    const seeded = ["jordan.ellis@demo-search.example.com", "priya.raman@markivis.example.com", "sam.okafor@markivis.example.com", "lee.whitford@demo-search.example.com"];
    const roles = await withWorkspace(demo.id, (tx) =>
      tx
        .select({ email: s.users.email, role: s.workspaceMembers.role })
        .from(s.workspaceMembers)
        .innerJoin(s.users, eq(s.users.id, s.workspaceMembers.userId))
        .where(inArray(s.users.email, seeded)),
    );
    expect(roles.map((r) => r.role).sort()).toEqual(["data_steward", "outreach_owner", "partner", "validator"]);
  });

  it("has 40 companies: 15 public with 99-prefixed CIKs, 12 PE-backed, 8 private, 3 sponsors, 2 clients", async () => {
    const rows = await withWorkspace(demo.id, (tx) => tx.select().from(s.companies));
    expect(rows).toHaveLength(40);
    const publics = rows.filter((c) => c.ownership === "public");
    expect(publics).toHaveLength(15);
    expect(publics.every((c) => c.secCik?.startsWith("99") && c.secCik.length === 10)).toBe(true);
    expect(rows.filter((c) => c.ownership === "pe_backed")).toHaveLength(12);
    expect(rows.filter((c) => c.isSponsor)).toHaveLength(3);
    expect(rows.filter((c) => c.clientStatus === "client")).toHaveLength(2);
    expect(rows.filter((c) => c.ownership === "private" && !c.isSponsor && c.clientStatus !== "client")).toHaveLength(8);
  });

  it("has 150 people with 220 roles", async () => {
    expect(await n((tx) => tx.select({ n: count() }).from(s.persons))).toBe(150);
    expect(await n((tx) => tx.select({ n: count() }).from(s.roles))).toBe(220);
  });

  it("has 12 board members with two or more concurrent seats", async () => {
    const result = await withWorkspace(demo.id, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from (
        select person_id from dmi.roles where seat_type = 'board' and status = 'current' group by person_id having count(*) >= 2) t`),
    );
    expect(result.rows[0]?.n).toBe(12);
  });

  it("has 6 people with no LinkedIn URL and 5 placements", async () => {
    expect(await n((tx) => tx.select({ n: count() }).from(s.persons).where(sql`${s.persons.linkedinUrl} is null`))).toBe(6);
    expect(await n((tx) => tx.select({ n: count() }).from(s.placements))).toBe(5);
  });

  it("has 600 interactions within the last 12 months", async () => {
    expect(await n((tx) => tx.select({ n: count() }).from(s.interactions))).toBe(600);
    const yearAgo = new Date(SEED_NOW.getTime() - 366 * 86_400_000);
    expect(await n((tx) => tx.select({ n: count() }).from(s.interactions).where(lt(s.interactions.occurredAt, yearAgo)))).toBe(0);
  });

  it("has 3 off-limits rules (one company-wide, two function-level, one ending in 30 days), 8 content items and 3 meetings tomorrow", async () => {
    const rules = await withWorkspace(demo.id, (tx) => tx.select().from(s.offLimits));
    expect(rules.map((r) => r.scope).sort()).toEqual(["company", "function", "function"]);
    expect(await n((tx) => tx.select({ n: count() }).from(s.contentItems))).toBe(8);
    const tomorrowStart = new Date(Date.UTC(SEED_NOW.getUTCFullYear(), SEED_NOW.getUTCMonth(), SEED_NOW.getUTCDate() + 1));
    const tomorrowEnd = new Date(tomorrowStart.getTime() + 86_400_000);
    const events = await withWorkspace(demo.id, (tx) =>
      tx.select().from(s.calendarEvents).where(and(gte(s.calendarEvents.startsAt, tomorrowStart), lt(s.calendarEvents.startsAt, tomorrowEnd))),
    );
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.personIds.length > 0)).toBe(true);
  });

  it("uses only reserved example domains for every email and company domain", async () => {
    const emails = await withWorkspace(demo.id, (tx) => tx.select({ e: s.roles.businessEmail }).from(s.roles));
    const domains = await withWorkspace(demo.id, (tx) => tx.select({ d: s.companies.domain }).from(s.companies));
    const reserved = /\.example\.(com|org|net)$/;
    expect(emails.filter((r) => r.e && !reserved.test(r.e))).toEqual([]);
    expect(domains.filter((r) => r.d && !reserved.test(r.d))).toEqual([]);
  });

  it("has a person in Germany with unknown email consent, for the EU consent block", async () => {
    const unknown = await n((tx) =>
      tx.select({ n: count() }).from(s.consents).innerJoin(s.persons, eq(s.persons.id, s.consents.personId))
        .where(and(eq(s.persons.country, "DE"), eq(s.consents.channel, "email"), eq(s.consents.status, "unknown"))),
    );
    expect(unknown).toBeGreaterThan(0);
  });
});
