/**
 * Relationships (BRD 11.4 to 11.7): acceptance scenarios 13 (score and band), 14 (going quiet)
 * and 15 (warm path), plus derived and manual connections. Rebuilds the test database before and
 * after, since scores, connections and alerts are written.
 */
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, withWorkspace, type Tx } from "@/db/client";
import * as s from "@/db/schema";
import { loadSeed } from "@/db/seed";
import { addManualConnection, deriveConnections } from "@/domain/connections";
import { findPaths } from "@/domain/paths";
import { raiseGoingQuiet } from "@/domain/quiet";
import { recomputeScores } from "@/domain/relationships";
import { bandOf, computeScore, DEFAULT_SCORING } from "@/domain/scoring";
import { resetDatabase } from "../../scripts/migrate";
import { loadFixtures, type WorkspaceFixture } from "./helpers";
import { SEED_NOW, TEST_DATABASE_ENV } from "./env";

const NOW = new Date(SEED_NOW);
const TODAY = NOW.toISOString().slice(0, 10);
const DAY = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);
let demo: WorkspaceFixture;
let partnerId: string;

async function rebuild() {
  await closeDatabase();
  await resetDatabase(TEST_DATABASE_ENV.DATABASE_MIGRATE_URL);
  await loadSeed(SEED_NOW);
}
const inDemo = <T>(fn: (tx: Tx) => Promise<T>) => withWorkspace(demo.id, fn);

let n = 0;
async function newPerson(tx: Tx, name: string, over: Partial<typeof s.persons.$inferInsert> = {}) {
  const [p] = await tx.insert(s.persons).values({ workspaceId: demo.id, fullName: name, nameNormalised: name.toLowerCase(), country: "US", relationshipOwnerId: partnerId, ...over }).returning();
  return p!;
}
async function interactionsFor(tx: Tx, personId: string, list: { channel: "meeting" | "email" | "call"; direction: "two_way" | "outbound" | "inbound"; daysAgo: number; thread?: string }[]) {
  for (const x of list) {
    await tx.insert(s.interactions).values({ workspaceId: demo.id, personId, channel: x.channel, direction: x.direction, occurredAt: ago(x.daysAgo), ourUserId: partnerId, provider: "manual", externalId: `test-${++n}`, capturedBy: "manual", threadKey: x.thread ?? null });
  }
}
/** A strong or warm history: a meeting and a replied thread every 20 days, ending `lastDaysAgo`. */
const warmHistory = (lastDaysAgo: number, span = 200) =>
  Array.from({ length: Math.floor(span / 20) }, (_, k) => lastDaysAgo + k * 20).flatMap((d) => [
    { channel: "meeting" as const, direction: "two_way" as const, daysAgo: d },
    { channel: "email" as const, direction: "outbound" as const, daysAgo: d + 2, thread: `th-${d}-${n}` },
    { channel: "email" as const, direction: "inbound" as const, daysAgo: d + 1, thread: `th-${d}-${n}` },
  ]);

beforeAll(async () => {
  await rebuild();
  ({ demo } = await loadFixtures());
  partnerId = demo.partnerUserId;
  await deriveConnections(demo.id, TODAY);
  await recomputeScores(demo.id, NOW);
}, 120_000);

afterAll(async () => {
  await rebuild();
  await closeDatabase();
}, 60_000);

describe("scores (BRD 11.4)", () => {
  it("scenario 13: the stored score for a named demo person matches the formula to the integer, and the band its thresholds", async () => {
    // The demo person with the most interactions, by name, so the check names someone real in the seed.
    const [top] = await inDemo((tx) =>
      tx.select({ id: s.persons.id, name: s.persons.fullName, n: count(s.interactions.id) }).from(s.persons).innerJoin(s.interactions, eq(s.interactions.personId, s.persons.id)).groupBy(s.persons.id, s.persons.fullName).orderBy(sql`count(${s.interactions.id}) desc`, s.persons.fullName).limit(1),
    );
    const rows = await inDemo((tx) => tx.select({ channel: s.interactions.channel, direction: s.interactions.direction, occurredAt: s.interactions.occurredAt, threadKey: s.interactions.threadKey }).from(s.interactions).where(eq(s.interactions.personId, top!.id)));
    const expected = computeScore(rows, NOW, DEFAULT_SCORING);
    const [stored] = await inDemo((tx) => tx.select().from(s.relationshipScores).where(and(eq(s.relationshipScores.personId, top!.id), isNull(s.relationshipScores.userId))));
    expect({ name: top!.name, score: stored!.score, band: stored!.band }).toEqual({ name: top!.name, score: expected.score, band: expected.band });
    expect(stored!.band).toBe(bandOf(stored!.score, DEFAULT_SCORING.bands));
    // The factors are stored with raw and normalised values, so the page can explain the score.
    expect(stored!.factors).toMatchObject({ recency: { value: expected.factors.recency.value }, depth: { raw: expected.factors.depth.raw } });
    // And a per-user score for the partner who holds the relationship.
    const [mine] = await inDemo((tx) => tx.select().from(s.relationshipScores).where(and(eq(s.relationshipScores.personId, top!.id), eq(s.relationshipScores.userId, partnerId))));
    expect(mine).toBeTruthy();
  });

  it("every band is represented across the seed", async () => {
    const bands = await inDemo((tx) => tx.selectDistinct({ b: s.relationshipScores.band }).from(s.relationshipScores).where(isNull(s.relationshipScores.userId)));
    expect(bands.map((b) => b.b).sort()).toEqual(["cold", "cooling", "none", "strong", "warm"]);
  });
});

describe("going quiet (BRD 11.5)", () => {
  it("scenario 14: a priority person, warm 120 days ago and silent for 91 days, gets one alert and one re-engage action, and none again for 90 days", async () => {
    const person = await inDemo(async (tx) => {
      const p = await newPerson(tx, "Quentin Quietwater", { isPriority: true });
      await interactionsFor(tx, p.id, warmHistory(91));
      return p;
    });
    const rows = await inDemo((tx) => tx.select({ channel: s.interactions.channel, direction: s.interactions.direction, occurredAt: s.interactions.occurredAt, threadKey: s.interactions.threadKey }).from(s.interactions).where(eq(s.interactions.personId, person.id)));
    expect(computeScore(rows, ago(120)).band).toMatch(/^(warm|strong)$/);

    await raiseGoingQuiet(demo.id, NOW);
    const signals = await inDemo((tx) => tx.select().from(s.signals).where(and(eq(s.signals.personId, person.id), eq(s.signals.type, "internal_relationship_quiet"))));
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ priority: 2, status: "confirmed" });
    const actions = await inDemo((tx) => tx.select().from(s.actions).where(and(eq(s.actions.personId, person.id), eq(s.actions.type, "reengage"))));
    expect(actions).toHaveLength(1);

    // Tomorrow: no second alert. After dismissing the action, 30 days on: still none (the 90-day limit).
    await raiseGoingQuiet(demo.id, new Date(NOW.getTime() + DAY));
    await inDemo((tx) => tx.update(s.actions).set({ status: "dismissed", dismissReason: "wrong_timing" }).where(eq(s.actions.id, actions[0]!.id)));
    await raiseGoingQuiet(demo.id, new Date(NOW.getTime() + 30 * DAY));
    expect(await inDemo(async (tx) => (await tx.select({ n: count() }).from(s.signals).where(and(eq(s.signals.personId, person.id), eq(s.signals.type, "internal_relationship_quiet"))))[0]!.n)).toBe(1);
    // After 90 days it may alert again.
    await raiseGoingQuiet(demo.id, new Date(NOW.getTime() + 91 * DAY));
    expect(await inDemo(async (tx) => (await tx.select({ n: count() }).from(s.signals).where(and(eq(s.signals.personId, person.id), eq(s.signals.type, "internal_relationship_quiet"))))[0]!.n)).toBe(2);
  });

  it("does not alert for people who are not priority, or who were in touch within the quiet period", async () => {
    const [notPriority, recent] = await inDemo(async (tx) => {
      const a = await newPerson(tx, "Nadia Notpriority", { isPriority: false });
      await interactionsFor(tx, a.id, warmHistory(95));
      const b = await newPerson(tx, "Rhys Recentcall", { isPriority: true });
      await interactionsFor(tx, b.id, warmHistory(60));
      return [a, b];
    });
    await raiseGoingQuiet(demo.id, NOW);
    const found = await inDemo((tx) => tx.select({ id: s.signals.personId }).from(s.signals).where(and(eq(s.signals.type, "internal_relationship_quiet"), sql`${s.signals.personId} in (${notPriority.id}::uuid, ${recent.id}::uuid)`)));
    expect(found).toEqual([]);
  });
});

describe("connections and warm paths (BRD 11.6, 11.7)", () => {
  it("derives connections from the seeded roles, idempotently", async () => {
    const before = await inDemo(async (tx) => (await tx.select({ n: count() }).from(s.connections).where(eq(s.connections.derived, true)))[0]!.n);
    expect(before).toBeGreaterThan(0);
    const again = await deriveConnections(demo.id, TODAY);
    expect(again.removed).toBe(0);
    expect(await inDemo(async (tx) => (await tx.select({ n: count() }).from(s.connections).where(eq(s.connections.derived, true)))[0]!.n)).toBe(before);
  });

  it("scenario 15: a target with no direct relationship, and a connector who shared a board with them and is strong with the partner, gets that one-hop path first, explained", async () => {
    const { target, connector, blocked } = await inDemo(async (tx) => {
      const [company] = await tx.insert(s.companies).values({ workspaceId: demo.id, name: "Ferncastle Holdings", nameNormalised: "ferncastle holdings", employeeCount: 900 }).returning();
      const t = await newPerson(tx, "Tamsin Targetworth");
      const c = await newPerson(tx, "Cyrus Connorley");
      const dnc = await newPerson(tx, "Dora Donotcontact", { status: "do_not_contact" });
      for (const [p, start] of [[t, "2019-03-01"], [c, "2019-01-01"], [dnc, "2019-01-01"]] as const) {
        await tx.insert(s.roles).values({ workspaceId: demo.id, personId: p.id, companyId: company!.id, seatType: "board", title: "Independent Director", titleNormalised: "Director", seniority: "board", effectiveOn: start, endedOn: "2023-06-30", status: "ended" });
      }
      await interactionsFor(tx, c.id, warmHistory(3, 360));
      await interactionsFor(tx, dnc.id, warmHistory(3, 360));
      return { target: t, connector: c, blocked: dnc };
    });
    await deriveConnections(demo.id, TODAY);
    await recomputeScores(demo.id, NOW);

    const paths = await inDemo((tx) => findPaths(tx, target.id, TODAY));
    expect(paths[0]).toMatchObject({ kind: "one_hop", connector_person_id: connector.id, connection_type: "shared_board", owner_user_id: partnerId });
    expect(paths[0]!.strength).toBeCloseTo(0.8, 2);
    expect(paths[0]!.explanation).toBe(`Jordan Ellis has a strong relationship with Cyrus Connorley, who sat on the Ferncastle Holdings board with Tamsin Targetworth from 2019 to 2023.`);
    expect(paths.some((p) => p.kind === "direct")).toBe(false);
    expect(paths.some((p) => p.connector_person_id === blocked.id)).toBe(false);
  });

  it("a manual connection counts at its type's weight", async () => {
    const { target, connector } = await inDemo(async (tx) => {
      const t = await newPerson(tx, "Ottilie Outreachable");
      const c = await newPerson(tx, "Marek Manualink");
      await interactionsFor(tx, c.id, warmHistory(3, 360));
      return { target: t, connector: c };
    });
    await recomputeScores(demo.id, NOW);
    await inDemo((tx) => addManualConnection(tx, { workspaceId: demo.id, userId: partnerId, role: "partner" }, { personId: target.id, otherId: connector.id, type: "reported_to" }));
    const [path] = await inDemo((tx) => findPaths(tx, target.id, TODAY));
    expect(path).toMatchObject({ kind: "one_hop", connector_person_id: connector.id, connection_type: "reported_to" });
    const [score] = await inDemo((tx) => tx.select({ score: s.relationshipScores.score }).from(s.relationshipScores).where(and(eq(s.relationshipScores.personId, connector.id), isNull(s.relationshipScores.userId))));
    expect(path!.strength).toBeCloseTo(Math.min(score!.score / 100, 0.9), 2);
  });
});

