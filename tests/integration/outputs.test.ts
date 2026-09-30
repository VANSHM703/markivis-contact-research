/**
 * Outputs and sync (BRD 12.5 to 12.7, 15): acceptance scenarios 18 (approval and send), 19 (reply
 * detection) and 20 (meeting brief), automatic meeting outcomes, the Graph sent-message link, and
 * the HubSpot sync in mock mode. Rebuilds the test database before and after.
 */
import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiAdapter } from "@/ai/adapter";
import type { BriefInput } from "@/ai/contracts";
import { BRIEF_HEADINGS } from "@/ai/contracts";
import { createMockAi } from "@/ai/mock";
import { closeDatabase, withSystem, withWorkspace, type Tx } from "@/db/client";
import * as s from "@/db/schema";
import { loadSeed } from "@/db/seed";
import { applyCalendar, applyMailDelta } from "@/capture/capture";
import { saveConnection, type Connection } from "@/capture/connections";
import { approveAndSend, saveDraft, submitForApproval, type FlowActor } from "@/domain/action-flow";
import { createActionForSignal, draftForAction } from "@/domain/actions";
import { runBriefs } from "@/domain/briefs";
import { addMandateNote } from "@/domain/mandate-notes";
import { runCrmSync } from "@/crm/sync";
import { runDigest } from "@/digest/digest";
import { mockHttp } from "@/ingest/http";
import { graphSender } from "@/outreach/mailbox";
import { resetDatabase } from "../../scripts/migrate";
import { loadFixtures, type WorkspaceFixture } from "./helpers";
import { SEED_NOW, TEST_DATABASE_ENV } from "./env";

const NOW = new Date(SEED_NOW);
const ai = createMockAi(() => NOW);
let demo: WorkspaceFixture;
const actors = {} as Record<"partner" | "outreach_owner", FlowActor>;
let partnerEmail = "";
let connection: Connection;

async function rebuild() {
  await closeDatabase();
  await resetDatabase(TEST_DATABASE_ENV.DATABASE_MIGRATE_URL);
  await loadSeed(SEED_NOW);
}
const inDemo = <T>(fn: (tx: Tx) => Promise<T>) => withWorkspace(demo.id, fn);

/** A drafted email action for a US person with a verified email and no other actions. */
async function draftedAction(skip: string[] = []) {
  const [p] = await inDemo((tx) =>
    tx
      .select({ id: s.persons.id, email: s.roles.businessEmail })
      .from(s.persons)
      .innerJoin(s.roles, and(eq(s.roles.personId, s.persons.id), eq(s.roles.isPrimary, true), eq(s.roles.emailStatus, "verified"), eq(s.roles.status, "current")))
      .where(and(eq(s.persons.country, "US"), eq(s.persons.status, "active"), sql`not exists (select 1 from dmi.actions a where a.person_id = ${s.persons.id})`, skip.length ? sql`${s.persons.id} not in (${sql.join(skip.map((x) => sql`${x}::uuid`), sql`, `)})` : sql`true`))
      .limit(1),
  );
  const created = await inDemo(async (tx) => {
    const [signal] = await tx.insert(s.signals).values({ workspaceId: demo.id, subjectType: "person", personId: p!.id, type: "person_promotion", headline: "Promoted to the executive committee", foundBy: "feed_rule", confidence: "high", priority: 1, lane: "review", status: "confirmed", confirmedAt: NOW, dedupeKey: `t:${p!.id}` }).returning();
    return createActionForSignal(tx, signal!, NOW);
  });
  expect(await draftForAction(demo.id, created!.actionId, { ai, now: () => NOW })).toMatchObject({ kind: "drafted" });
  return { actionId: created!.actionId, personId: p!.id, email: p!.email! };
}

beforeAll(async () => {
  await rebuild();
  ({ demo } = await loadFixtures());
  const members = await withSystem("test", (tx) => tx.select({ userId: s.workspaceMembers.userId, role: s.workspaceMembers.role, email: s.users.email }).from(s.workspaceMembers).innerJoin(s.users, eq(s.users.id, s.workspaceMembers.userId)).where(eq(s.workspaceMembers.workspaceId, demo.id)));
  for (const role of ["partner", "outreach_owner"] as const) actors[role] = { workspaceId: demo.id, userId: members.find((m) => m.role === role)!.userId, role };
  partnerEmail = members.find((m) => m.role === "partner")!.email;
  const id = await inDemo((tx) => saveConnection(tx, { workspaceId: demo.id, userId: actors.partner.userId, provider: "microsoft", accountEmail: partnerEmail, tokens: null, mock: true }));
  connection = (await inDemo((tx) => tx.select().from(s.oauthConnections).where(eq(s.oauthConnections.id, id))))[0]!;
}, 120_000);

afterAll(async () => {
  await rebuild();
  await closeDatabase();
}, 60_000);

describe("approval, sending and outcomes (BRD 12.4 to 12.7)", () => {
  let sent: { actionId: string; personId: string; email: string };
  let threadKey: string;

  it("scenario 18: an outreach owner submits, the partner approves, it is sent from the partner's mailbox, logged, and the action is sent", async () => {
    sent = await draftedAction();
    const d = (await inDemo((tx) => tx.select().from(s.drafts).where(eq(s.drafts.actionId, sent.actionId))))[0]!;
    await inDemo((tx) => saveDraft(tx, actors.outreach_owner, sent.actionId, { subject: d.subject, body: `${d.body} ` + "See you soon." }));
    await inDemo((tx) => submitForApproval(tx, actors.outreach_owner, sent.actionId));
    // No sender passed: the partner's own mailbox sender is used (the mock provider in mock mode).
    await approveAndSend(actors.partner, sent.actionId, { now: NOW });
    const [action] = await inDemo((tx) => tx.select().from(s.actions).where(eq(s.actions.id, sent.actionId)));
    expect(action).toMatchObject({ status: "sent", outcome: "none" });
    const [logged] = await inDemo((tx) => tx.select().from(s.interactions).where(and(eq(s.interactions.personId, sent.personId), eq(s.interactions.direction, "outbound"), eq(s.interactions.channel, "email"), eq(s.interactions.provider, "mock"))));
    expect(logged).toMatchObject({ ourUserId: actors.partner.userId, capturedBy: "auto" });
    threadKey = logged!.threadKey!;
    expect(threadKey).toMatch(/^mock-conv-/);
  });

  it("scenario 19: a reply in the same conversation sets the outcome to replied; a message in another thread does not", async () => {
    const at = new Date(NOW.getTime() + 3_600_000);
    const msg = (id: string, conversationId: string) => ({ id, internetMessageId: `<${id}@x>`, conversationId, sentAt: at.toISOString(), from: sent.email, to: [partnerEmail], cc: [], subject: "Re: Congratulations" });
    await inDemo((tx) => applyMailDelta(tx, connection, [msg("other", "conv-unrelated")], "mock:1", at));
    expect((await inDemo((tx) => tx.select({ outcome: s.actions.outcome }).from(s.actions).where(eq(s.actions.id, sent.actionId))))[0]!.outcome).toBe("none");
    const result = await inDemo((tx) => applyMailDelta(tx, connection, [msg("reply", threadKey)], "mock:1", at));
    expect(result.replies).toBe(1);
    expect((await inDemo((tx) => tx.select({ outcome: s.actions.outcome, outcomeAt: s.actions.outcomeAt }).from(s.actions).where(eq(s.actions.id, sent.actionId))))[0]).toEqual({ outcome: "replied", outcomeAt: at });
  });

  it("a meeting with the person after the send sets the outcome to meeting", async () => {
    const starts = new Date(NOW.getTime() + 2 * 86_400_000);
    await inDemo((tx) => applyCalendar(tx, connection, [{ id: "evt-after-send", title: "Coffee", startsAt: starts.toISOString(), endsAt: new Date(starts.getTime() + 1_800_000).toISOString(), organizer: partnerEmail, attendees: [partnerEmail, sent.email], cancelled: false }], NOW));
    expect((await inDemo((tx) => tx.select({ outcome: s.actions.outcome }).from(s.actions).where(eq(s.actions.id, sent.actionId))))[0]!.outcome).toBe("meeting");
  });

  it("a message sent through Graph is linked when capture reads it from Sent Items, instead of being logged twice, and its thread then catches replies", async () => {
    const a = await draftedAction([sent.personId]);
    await inDemo(async (tx) => {
      const [d] = await tx.select().from(s.drafts).where(eq(s.drafts.actionId, a.actionId));
      await tx.update(s.drafts).set({ subject: "Congratulations on the committee seat" }).where(eq(s.drafts.id, d!.id));
    });
    const graph = graphSender(mockHttp(() => ({ status: 202, headers: {}, text: "" })), async () => "t");
    await approveAndSend(actors.partner, a.actionId, { sender: graph, now: NOW });
    const provisional = await inDemo((tx) => tx.select().from(s.interactions).where(and(eq(s.interactions.personId, a.personId), eq(s.interactions.direction, "outbound"))));
    expect(provisional).toHaveLength(1);
    expect(provisional[0]!.threadKey).toBeNull();
    // Capture reads the same message back from Sent Items two minutes later.
    const back = new Date(NOW.getTime() + 120_000);
    await inDemo((tx) => applyMailDelta(tx, connection, [{ id: "s1", internetMessageId: "<s1@graph>", conversationId: "graph-conv-1", sentAt: back.toISOString(), from: partnerEmail, to: [a.email], cc: [], subject: "Congratulations on the committee seat" }], "mock:1", back));
    const after = await inDemo((tx) => tx.select().from(s.interactions).where(and(eq(s.interactions.personId, a.personId), eq(s.interactions.direction, "outbound"))));
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ threadKey: "graph-conv-1", externalId: `<s1@graph>|${a.personId}` });
    const replyAt = new Date(NOW.getTime() + 7_200_000);
    await inDemo((tx) => applyMailDelta(tx, connection, [{ id: "r1", internetMessageId: "<r1@x>", conversationId: "graph-conv-1", sentAt: replyAt.toISOString(), from: a.email, to: [partnerEmail], cc: [], subject: "Re: Congratulations on the committee seat" }], "mock:1", replyAt));
    expect((await inDemo((tx) => tx.select({ outcome: s.actions.outcome }).from(s.actions).where(eq(s.actions.id, a.actionId))))[0]!.outcome).toBe("replied");
  });
});

describe("meeting briefs (BRD 12.6)", () => {
  it("scenario 20: the hourly job briefs tomorrow's meeting with a tracked attendee, with all seven headings, and the digest shows it", async () => {
    // Seeded meetings start tomorrow at 14:00 UTC and later; the seed clock is 12:00 UTC, so the first is 26 hours ahead.
    const [event] = await inDemo((tx) => tx.select().from(s.calendarEvents).where(sql`${s.calendarEvents.externalId} like 'seed-cal-%'`).orderBy(s.calendarEvents.startsAt).limit(1));
    expect((event!.startsAt.getTime() - NOW.getTime()) / 3_600_000).toBeLessThanOrEqual(26);

    // The brief input never carries a mandate note, or a private subject.
    await inDemo((tx) => addMandateNote(tx, actors.partner, { personId: event!.personIds[0]! }, "Confidential: board is unhappy with the CEO."));
    let seen: BriefInput | null = null;
    const spy: AiAdapter = { ...ai, meetingBrief: async (input) => ((seen = input), ai.meetingBrief(input)) };
    const result = await runBriefs(demo.id, { now: NOW, ai: spy });
    expect(result.made).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(seen)).not.toContain("board is unhappy");

    const [withBrief] = await inDemo((tx) => tx.select().from(s.calendarEvents).where(eq(s.calendarEvents.id, event!.id)));
    expect(withBrief!.briefId).toBeTruthy();
    const [brief] = await inDemo((tx) => tx.select().from(s.briefs).where(eq(s.briefs.id, withBrief!.briefId!)));
    expect(brief!.contentMarkdown.match(/^## .+$/gm)).toEqual(BRIEF_HEADINGS.map((h) => `## ${h}`));
    expect(brief).toMatchObject({ personId: event!.personIds[0], calendarEventId: event!.id });

    const [email] = await inDemo((tx) => tx.select().from(s.notifications).where(and(eq(s.notifications.kind, "brief"), eq(s.notifications.dedupeKey, `brief:${event!.id}`))));
    expect(email).toMatchObject({ userId: event!.userId });
    // Running again an hour later writes nothing new.
    expect((await runBriefs(demo.id, { now: new Date(NOW.getTime() + 3_600_000), ai })).made).toBe(0);

    // The next morning's digest, once the meeting is inside its 24-hour window.
    await runDigest(demo.id, { now: new Date(event!.startsAt.getTime() - 6 * 3_600_000), mailer: { mode: "mock", send: async () => ({ messageId: "d" }) } });
    const [digest] = await inDemo((tx) => tx.select().from(s.notifications).where(and(eq(s.notifications.kind, "digest"), eq(s.notifications.userId, event!.userId))));
    expect(digest!.bodyText).toContain("Meetings in the next 24 hours");
    expect(digest!.bodyText).toContain(`brief=${withBrief!.briefId}`);
  });
});

describe("HubSpot sync (BRD 15, P1)", () => {
  it("does nothing while the flag is off", async () => {
    expect(await runCrmSync(demo.id, { now: NOW })).toEqual({ skipped: "HubSpot is not connected for this workspace." });
  });

  it("with the flag on: pushes contacts and notes, reads back an unsubscribe as an opt-out and a changed title as a conflict, and a second run pushes no note twice", async () => {
    await withSystem("test", (tx) => tx.update(s.workspaces).set({ flags: sql`jsonb_set(${s.workspaces.flags}, '{crm.hubspot}', 'true')` }).where(eq(s.workspaces.id, demo.id)));
    const conflictsBefore = await inDemo(async (tx) => (await tx.select({ n: count() }).from(s.queueItems).where(eq(s.queueItems.kind, "data_conflict")))[0]!.n);
    const first = await runCrmSync(demo.id, { now: NOW });
    expect(first).toMatchObject({ optOuts: 1, conflicts: 1 });
    if ("skipped" in first) throw new Error(first.skipped);
    expect(first.contacts).toBeGreaterThan(50);
    expect(first.notes).toBeGreaterThan(0);
    const [optOut] = await inDemo((tx) => tx.select().from(s.consents).where(and(eq(s.consents.capturedVia, "crm"), eq(s.consents.status, "opted_out"))));
    expect(optOut).toMatchObject({ channel: "email", purpose: "outreach" });
    expect(await inDemo(async (tx) => (await tx.select({ n: count() }).from(s.queueItems).where(eq(s.queueItems.kind, "data_conflict")))[0]!.n)).toBe(conflictsBefore + 1);

    const second = await runCrmSync(demo.id, { now: new Date(NOW.getTime() + 900_000) });
    expect(second).toMatchObject({ optOuts: 0 });
    const linkedNotes = await inDemo(async (tx) => (await tx.select({ n: count() }).from(s.crmLinks).where(eq(s.crmLinks.entityType, "interaction")))[0]!.n);
    expect(linkedNotes).toBe(first.notes + ("skipped" in second ? 0 : second.notes));
  });
});
