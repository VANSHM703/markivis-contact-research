/**
 * Activity capture (BRD 11.1 to 11.3): acceptance scenarios 11 (mail capture scope) and 12
 * (private thread), plus idempotency, calendar meetings, exclusions, revocation, the capture flag,
 * token encryption and refresh, and manual logging. Rebuilds the test database before and after.
 */
import { readFileSync } from "node:fs";
import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, withSystem, withWorkspace } from "@/db/client";
import * as s from "@/db/schema";
import { loadSeed } from "@/db/seed";
import { runCalendarCapture, runMailCapture } from "@/capture/capture";
import { providerFor, revokeConnection, saveConnection } from "@/capture/connections";
import { logInteraction } from "@/capture/manual";
import { setThreadPrivate } from "@/capture/privacy";
import { mockHttp, ok } from "@/ingest/http";
import { buildContext } from "@/lib/context";
import { decryptSecret } from "@/lib/crypto";
import { ForbiddenError } from "@/lib/permissions";
import { interactionsFor } from "@/server/capture";
import { resetDatabase } from "../../scripts/migrate";
import { loadFixtures, type WorkspaceFixture } from "./helpers";
import { SEED_NOW, TEST_DATABASE_ENV } from "./env";

// buildContext is used directly; sign-in itself is not under test.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: { GET: vi.fn(), POST: vi.fn() }, isMockSignInEnabled: () => true }));

const NOW = new Date(SEED_NOW);
let demo: WorkspaceFixture;
const users = {} as Record<"partner" | "outreach" | "validator", { id: string; email: string }>;

async function rebuild() {
  await closeDatabase();
  await resetDatabase(TEST_DATABASE_ENV.DATABASE_MIGRATE_URL);
  await loadSeed(SEED_NOW);
}
const inDemo = <T>(fn: Parameters<typeof withWorkspace<T>>[1]) => withWorkspace(demo.id, fn);
const capturedCount = (userId: string) => inDemo(async (tx) => (await tx.select({ n: count() }).from(s.interactions).where(and(eq(s.interactions.ourUserId, userId), sql`${s.interactions.externalId} like '<mock-%'`)))[0]!.n);

beforeAll(async () => {
  await rebuild();
  ({ demo } = await loadFixtures());
  const rows = await withSystem("test", (tx) => tx.select({ id: s.users.id, email: s.users.email, role: s.workspaceMembers.role }).from(s.workspaceMembers).innerJoin(s.users, eq(s.users.id, s.workspaceMembers.userId)).where(eq(s.workspaceMembers.workspaceId, demo.id)));
  users.partner = rows.find((r) => r.role === "partner")!;
  users.outreach = rows.find((r) => r.role === "outreach_owner")!;
  users.validator = rows.find((r) => r.role === "validator")!;
}, 120_000);

afterAll(async () => {
  await rebuild();
  await closeDatabase();
}, 60_000);

const fixture = (email: string, file: string) => JSON.parse(readFileSync(`fixtures/capture/microsoft/${email}/${file}`, "utf8")) as { messages: { subject: string }[] };

describe("mail capture (BRD 11.1)", () => {
  let connectionId: string;

  it("scenario 11: a delta of 50 messages, 4 involving tracked people, creates exactly 4 interactions and stores nothing from the other 46", async () => {
    const delta = fixture(users.partner.email, "mail.json");
    expect(delta.messages).toHaveLength(50);
    connectionId = await inDemo((tx) => saveConnection(tx, { workspaceId: demo.id, userId: users.partner.id, provider: "microsoft", accountEmail: users.partner.email, tokens: null, mock: true }));
    const before = await inDemo(async (tx) => (await tx.select({ n: count() }).from(s.interactions))[0]!.n);
    const result = await runMailCapture(demo.id, { connectionId, now: NOW });
    expect(result).toMatchObject({ connections: 1, created: 4, errors: [] });
    expect(await inDemo(async (tx) => (await tx.select({ n: count() }).from(s.interactions))[0]!.n)).toBe(before + 4);

    const trackedSubjects = new Set((await inDemo((tx) => tx.select({ subject: s.interactions.subject }).from(s.interactions).where(sql`${s.interactions.externalId} like '<mock-%'`))).map((r) => r.subject));
    const ignored = delta.messages.map((m) => m.subject).filter((subject) => !trackedSubjects.has(subject));
    expect(ignored).toHaveLength(46);
    // No table holds any trace of the ignored messages.
    const leak = await withSystem("test", async (tx) => {
      const hits: string[] = [];
      for (const subject of ignored) {
        const [row] = await tx.execute(sql`select
          (select count(*) from dmi.interactions where subject = ${subject})
          + (select count(*) from dmi.audit_log where after::text like ${`%${subject}%`})
          + (select count(*) from dmi.calendar_events where title = ${subject})
          + (select count(*) from dmi.raw_items where title = ${subject}) as n`).then((r) => r.rows as { n: string }[]);
        if (Number(row!.n) > 0) hits.push(subject);
      }
      return hits;
    });
    expect(leak).toEqual([]);
  });

  it("stores direction, thread key and the matched role, and a second run adds nothing", async () => {
    const rows = await inDemo((tx) => tx.select().from(s.interactions).where(sql`${s.interactions.externalId} like '<mock-%'`));
    expect(rows.map((r) => r.direction).sort()).toEqual(["inbound", "inbound", "outbound", "outbound"]);
    expect(rows.every((r) => r.threadKey?.startsWith("conv-") && r.roleId && r.capturedBy === "auto" && r.provider === "microsoft")).toBe(true);
    expect((await runMailCapture(demo.id, { connectionId, now: NOW })).created).toBe(0);
    // Even replaying the whole delta is idempotent on the message ids.
    await inDemo((tx) => tx.update(s.oauthConnections).set({ deltaCursor: null }).where(eq(s.oauthConnections.id, connectionId)));
    expect((await runMailCapture(demo.id, { connectionId, now: NOW })).created).toBe(0);
    const [c] = await inDemo((tx) => tx.select().from(s.oauthConnections).where(eq(s.oauthConnections.id, connectionId)));
    expect(c!.deltaCursor).toBe("mock:1");
    expect(c!.lastSyncAt).toEqual(NOW);
  });

  it("logs a meeting only for an ended, not cancelled event with a tracked attendee, and keeps upcoming ones for briefs", async () => {
    const result = await runCalendarCapture(demo.id, { connectionId, now: NOW });
    expect(result.meetings).toBe(1);
    const events = await inDemo((tx) => tx.select().from(s.calendarEvents).where(sql`${s.calendarEvents.externalId} like 'mock-event-%'`));
    expect(events.map((e) => e.externalId).sort()).toEqual(["mock-event-1", "mock-event-2"]);
    expect(events.every((e) => e.personIds.length === 1)).toBe(true);
    expect((await runCalendarCapture(demo.id, { connectionId, now: NOW })).meetings).toBe(0);
  });
});

describe("privacy (BRD 11.3)", () => {
  it("scenario 12: in a thread the partner marks private, an outreach owner sees the interaction but not its subject", async () => {
    const [row] = await inDemo((tx) => tx.select().from(s.interactions).where(sql`${s.interactions.externalId} like '<mock-%'`).limit(1));
    await expect(inDemo((tx) => setThreadPrivate(tx, { workspaceId: demo.id, userId: users.outreach.id, role: "outreach_owner" }, row!.threadKey!, true))).rejects.toBeInstanceOf(ForbiddenError);
    await inDemo((tx) => setThreadPrivate(tx, { workspaceId: demo.id, userId: users.partner.id, role: "partner" }, row!.threadKey!, true));

    const asOutreach = await interactionsFor((await buildContext(users.outreach.id, demo.id))!, row!.personId);
    const asPartner = await interactionsFor((await buildContext(users.partner.id, demo.id))!, row!.personId);
    expect(asOutreach.total).toBe(asPartner.total);
    const seenByOutreach = asOutreach.rows.find((r) => r.id === row!.id)!;
    expect(seenByOutreach).toMatchObject({ isPrivate: true, subject: null, hidden: true });
    expect(asPartner.rows.find((r) => r.id === row!.id)!.subject).toBe(row!.subject);
    // A validator never sees subjects at all (BRD 5.4).
    const asValidator = await interactionsFor((await buildContext(users.validator.id, demo.id))!, row!.personId);
    expect(asValidator.rows.every((r) => r.subject === null)).toBe(true);
  });

  it("exclusions: a tracked person's excluded domain is never captured", async () => {
    const priyaMail = JSON.parse(readFileSync(`fixtures/capture/microsoft/${users.outreach.email}/mail.json`, "utf8")) as { messages: { from: string; to: string[] }[] };
    const trackedAddress = priyaMail.messages[0]!.to[0]!;
    await inDemo((tx) => tx.insert(s.captureExclusions).values({ workspaceId: demo.id, userId: users.outreach.id, pattern: trackedAddress.split("@")[1]! }));
    const connectionId = await inDemo((tx) => saveConnection(tx, { workspaceId: demo.id, userId: users.outreach.id, provider: "microsoft", accountEmail: users.outreach.email, tokens: null, mock: true }));
    await runMailCapture(demo.id, { connectionId, now: NOW });
    const rows = await inDemo((tx) => tx.select({ subject: s.interactions.subject }).from(s.interactions).where(and(eq(s.interactions.ourUserId, users.outreach.id), sql`${s.interactions.externalId} like '<mock-%'`)));
    expect(rows.map((r) => r.subject)).toEqual(["Re: Request for time"]);
  });

  it("manual logging: partners may mark an entry private, others may not", async () => {
    const [row] = await inDemo((tx) => tx.select({ personId: s.interactions.personId }).from(s.interactions).limit(1));
    const input = { channel: "call" as const, occurredAt: new Date(NOW.getTime() - 3_600_000), direction: "two_way" as const, summary: "Talked about the board", subject: null, isPrivate: true };
    const byOutreach = await inDemo((tx) => logInteraction(tx, { workspaceId: demo.id, userId: users.outreach.id, role: "outreach_owner" }, row!.personId, input));
    const byPartner = await inDemo((tx) => logInteraction(tx, { workspaceId: demo.id, userId: users.partner.id, role: "partner" }, row!.personId, input));
    const logged = await inDemo((tx) => tx.select({ id: s.interactions.id, isPrivate: s.interactions.isPrivate }).from(s.interactions).where(sql`${s.interactions.id} in (${byOutreach}::uuid, ${byPartner}::uuid)`));
    expect(logged.find((r) => r.id === byOutreach)!.isPrivate).toBe(false);
    expect(logged.find((r) => r.id === byPartner)!.isPrivate).toBe(true);
  });
});

describe("connections", () => {
  it("encrypts tokens at rest and refreshes an expired access token, saving the new one", async () => {
    const tokens = { accessToken: "plain-access-token-value", refreshToken: "plain-refresh-token", expiresAt: Date.now() - 1000, scopes: ["Mail.ReadBasic"] };
    const id = await inDemo((tx) => saveConnection(tx, { workspaceId: demo.id, userId: users.validator.id, provider: "microsoft", accountEmail: users.validator.email, tokens }));
    const [row] = await inDemo((tx) => tx.select().from(s.oauthConnections).where(eq(s.oauthConnections.id, id)));
    expect(row!.tokenCiphertext!.toString("utf8")).not.toContain("plain-access-token-value");
    expect(JSON.parse(decryptSecret(row!.tokenCiphertext!))).toMatchObject({ refreshToken: "plain-refresh-token" });

    const saved = { ...process.env };
    Object.assign(process.env, { DATA_MODE: "live", AUTH_MICROSOFT_CLIENT_ID: "cid", AUTH_MICROSOFT_CLIENT_SECRET: "cs", AUTH_MICROSOFT_TENANT: "t" });
    try {
      const auth: string[] = [];
      const http = mockHttp((req) => {
        if (req.method === "POST") return ok(JSON.stringify({ access_token: "refreshed-token", expires_in: 3600, refresh_token: "r2" }));
        auth.push(req.headers?.authorization ?? "");
        return ok(JSON.stringify({ mail: "sam@example.com" }));
      });
      expect(await providerFor(row!, { http }).accountEmail()).toBe("sam@example.com");
      expect(auth).toEqual(["Bearer refreshed-token"]);
      const [after] = await inDemo((tx) => tx.select().from(s.oauthConnections).where(eq(s.oauthConnections.id, id)));
      expect(JSON.parse(decryptSecret(after!.tokenCiphertext!))).toMatchObject({ accessToken: "refreshed-token", refreshToken: "r2" });
    } finally {
      process.env = saved;
    }
  });

  it("revoking deletes the tokens at once and stops sync; the capture flag stops it too", async () => {
    await inDemo((tx) => revokeConnection(tx, { workspaceId: demo.id, userId: users.validator.id }, "microsoft"));
    const [row] = await inDemo((tx) => tx.select().from(s.oauthConnections).where(eq(s.oauthConnections.userId, users.validator.id)));
    expect(row).toMatchObject({ status: "revoked", tokenCiphertext: null, tokenKeyId: null, deltaCursor: null });
    const before = await runMailCapture(demo.id, { now: NOW });
    expect(before.connections).toBe(2);
    await withSystem("test", (tx) => tx.update(s.workspaces).set({ flags: sql`jsonb_set(${s.workspaces.flags}, '{capture.microsoft}', 'false')` }).where(eq(s.workspaces.id, demo.id)));
    expect((await runMailCapture(demo.id, { now: NOW })).connections).toBe(0);
    await withSystem("test", (tx) => tx.update(s.workspaces).set({ flags: sql`jsonb_set(${s.workspaces.flags}, '{capture.microsoft}', 'true')` }).where(eq(s.workspaces.id, demo.id)));
    expect(await capturedCount(users.partner.id)).toBe(4);
  });
});
