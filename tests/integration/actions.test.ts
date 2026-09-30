/**
 * The action layer end to end (BRD 12): creation with the pre-action checks, merging within 7
 * days, drafting, approval, sending from the mock mailbox, LinkedIn, outcomes, escalation, the
 * digest and alerts. Acceptance scenarios 16, 17 and 21, plus the approval and send flow.
 *
 * Actions, drafts and sends commit across transactions, so this file rebuilds the test database
 * before and after, and the other files still see the untouched seed.
 */
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockAi } from "@/ai/mock";
import { closeDatabase, withSystem, withWorkspace, type Tx } from "@/db/client";
import * as s from "@/db/schema";
import { loadSeed } from "@/db/seed";
import {
  ActionFlowError, approveAndSend, approveDraft, dismissAction, markLinkedinSent, recordLawfulBasis, recordOutcome, saveDraft, sendAction, submitForApproval, type FlowActor,
} from "@/domain/action-flow";
import { createActionForSignal, createManualAction, draftForAction } from "@/domain/actions";
import { BLOCK_NOTES } from "@/domain/checks";
import { runSla } from "@/domain/sla";
import { runDigest } from "@/digest/digest";
import { ForbiddenError } from "@/lib/permissions";
import { alertAutoConfirmSuspended } from "@/mail/alerts";
import type { Mailer } from "@/mail/mailer";
import { deliverQueued } from "@/mail/notify";
import { mockMailboxSender } from "@/outreach/mailbox";
import { resetDatabase } from "../../scripts/migrate";
import { loadFixtures, type WorkspaceFixture } from "./helpers";
import { SEED_NOW, TEST_DATABASE_ENV } from "./env";

const NOW = new Date(SEED_NOW);
const ai = createMockAi(() => NOW);
let demo: WorkspaceFixture;
let harbor: WorkspaceFixture;
const actors: Record<"partner" | "outreach_owner" | "validator" | "data_steward", FlowActor> = {} as never;

async function rebuild() {
  await closeDatabase();
  await resetDatabase(TEST_DATABASE_ENV.DATABASE_MIGRATE_URL);
  await loadSeed(SEED_NOW);
}

const inDemo = <T>(fn: (tx: Tx) => Promise<T>) => withWorkspace(demo.id, fn);

/** A confirmed signal about a person, as the pipeline would leave it. */
async function confirmedSignal(tx: Tx, personId: string, opts: { type?: (typeof s.signals.$inferInsert)["type"]; priority?: number; headline?: string } = {}) {
  const [signal] = await tx
    .insert(s.signals)
    .values({
      workspaceId: demo.id,
      subjectType: "person",
      personId,
      type: opts.type ?? "person_promotion",
      headline: opts.headline ?? "Test change for the action layer",
      foundBy: "feed_rule",
      confidence: "high",
      priority: opts.priority ?? 1,
      lane: "review",
      status: "confirmed",
      confirmedAt: NOW,
      dedupeKey: `test:${personId}:${Math.random()}`,
    })
    .returning();
  return signal!;
}

/** A tracked, contactable US person with a verified email and no open actions. */
async function usPerson(skip: string[] = []): Promise<string> {
  const rows = await inDemo((tx) =>
    tx
      .select({ id: s.persons.id })
      .from(s.persons)
      .innerJoin(s.roles, and(eq(s.roles.personId, s.persons.id), eq(s.roles.isPrimary, true), eq(s.roles.emailStatus, "verified"), eq(s.roles.status, "current")))
      .where(and(eq(s.persons.country, "US"), eq(s.persons.status, "active"), eq(s.persons.isTracked, true), sql`not exists (select 1 from dmi.actions a where a.person_id = ${s.persons.id})`, sql`not ('potential_candidate' = all(${s.persons.contactTypes}) and cardinality(${s.persons.contactTypes}) > 0)`)),
  );
  const pick = rows.find((r) => !skip.includes(r.id));
  if (!pick) throw new Error("No suitable US person in the seed.");
  return pick.id;
}

async function latestDraft(actionId: string) {
  return inDemo(async (tx) => (await tx.select().from(s.drafts).where(eq(s.drafts.actionId, actionId)).orderBy(sql`${s.drafts.version} desc`).limit(1))[0]!);
}

async function actionRow(actionId: string) {
  return inDemo(async (tx) => (await tx.select().from(s.actions).where(eq(s.actions.id, actionId)))[0]!);
}

async function flowError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof ActionFlowError) return error.code;
    if (error instanceof ForbiddenError) return "forbidden";
    throw error;
  }
  return "no error";
}

beforeAll(async () => {
  await rebuild();
  ({ demo, harbor } = await loadFixtures());
  const members = await withSystem("test", (tx) => tx.select({ userId: s.workspaceMembers.userId, role: s.workspaceMembers.role }).from(s.workspaceMembers).where(eq(s.workspaceMembers.workspaceId, demo.id)));
  for (const role of ["partner", "outreach_owner", "validator", "data_steward"] as const) {
    actors[role] = { workspaceId: demo.id, userId: members.find((m) => m.role === role)!.userId, role };
  }
}, 120_000);

afterAll(async () => {
  await rebuild();
  await closeDatabase();
}, 60_000);

describe("creating actions (BRD 12.1, 12.2)", () => {
  it("scenario 17: a person in Germany with unknown email consent gets an action, but drafting and sending are blocked until a lawful basis is recorded", async () => {
    const [de] = await inDemo((tx) =>
      tx.select({ id: s.persons.id }).from(s.persons).innerJoin(s.consents, and(eq(s.consents.personId, s.persons.id), eq(s.consents.channel, "email"), eq(s.consents.status, "unknown"))).where(eq(s.persons.country, "DE")).limit(1),
    );
    expect(de, "the seed has a German person with unknown consent").toBeTruthy();
    const created = await inDemo(async (tx) => createActionForSignal(tx, await confirmedSignal(tx, de!.id), NOW));
    expect(created).toMatchObject({ needsDraft: false });
    expect(await actionRow(created!.actionId)).toMatchObject({ status: "open", blockedReason: BLOCK_NOTES.lawful_basis });

    expect(await draftForAction(demo.id, created!.actionId, { ai, now: () => NOW })).toMatchObject({ kind: "blocked", reason: "lawful_basis" });
    expect(await inDemo(async (tx) => (await tx.select({ n: count() }).from(s.drafts).where(eq(s.drafts.actionId, created!.actionId)))[0]!.n)).toBe(0);

    // Only a partner or the data steward can record the basis.
    expect(await flowError(inDemo((tx) => recordLawfulBasis(tx, actors.outreach_owner, de!.id, "Existing business relationship")))).toBe("forbidden");
    expect(await flowError(inDemo((tx) => recordLawfulBasis(tx, actors.data_steward, de!.id, "no")))).toBe("short_note");
    const needDraft = await inDemo((tx) => recordLawfulBasis(tx, actors.data_steward, de!.id, "Existing business relationship since 2024.", NOW));
    expect(needDraft).toEqual([created!.actionId]);
    const [consent] = await inDemo((tx) => tx.select().from(s.consents).where(and(eq(s.consents.personId, de!.id), eq(s.consents.channel, "email"), eq(s.consents.purpose, "outreach"))));
    expect(consent).toMatchObject({ status: "legitimate_interest", recordedBy: actors.data_steward.userId, jurisdiction: "DE" });
    expect((await actionRow(created!.actionId)).blockedReason).toBeNull();
    expect(await draftForAction(demo.id, created!.actionId, { ai, now: () => NOW })).toMatchObject({ kind: "drafted" });

    // Sending re-checks: with the basis withdrawn, approval and sending are blocked again and the
    // note is kept on the action.
    await inDemo((tx) => tx.update(s.consents).set({ status: "unknown" }).where(eq(s.consents.id, consent!.id)));
    expect(await flowError(inDemo((tx) => approveDraft(tx, actors.partner, created!.actionId, NOW)))).toBe("blocked");
    expect(await flowError(approveAndSend(actors.partner, created!.actionId, { sender: mockMailboxSender(), now: NOW }))).toBe("blocked");
    expect((await actionRow(created!.actionId)).blockedReason).toBe(BLOCK_NOTES.lawful_basis);
  });

  it("scenario 16: with a company-wide off-limits rule, a candidate draft is blocked with the off-limits reason and a client check-in is still allowed", async () => {
    const [exec] = await inDemo((tx) =>
      tx
        .select({ personId: s.roles.personId, company: s.companies.name })
        .from(s.offLimits)
        .innerJoin(s.companies, eq(s.companies.id, s.offLimits.companyId))
        .innerJoin(s.roles, and(eq(s.roles.companyId, s.offLimits.companyId), eq(s.roles.status, "current"), eq(s.roles.seatType, "executive")))
        .innerJoin(s.persons, eq(s.persons.id, s.roles.personId))
        .where(and(eq(s.offLimits.scope, "company"), eq(s.persons.status, "active"), sql`${s.persons.country} is distinct from 'DE' and ${s.persons.country} is distinct from 'GB'`))
        .limit(1),
    );
    expect(exec, "the seed has an executive at a company-wide off-limits client").toBeTruthy();
    const base = { personId: exec!.personId, ownerUserId: actors.partner.userId, dueAt: new Date(NOW.getTime() + 5 * 86_400_000) };

    const refused = await inDemo((tx) => createManualAction(tx, actors.partner, { ...base, type: "invite_interview", purpose: "candidate" }));
    expect(refused).toEqual({ refused: BLOCK_NOTES.off_limits(exec!.company) });

    const created = await inDemo((tx) => createManualAction(tx, actors.partner, { ...base, type: "check_in", purpose: "client" }));
    expect(created).toMatchObject({ needsDraft: true });
    const actionId = (created as { actionId: string }).actionId;
    expect(await draftForAction(demo.id, actionId, { ai, now: () => NOW })).toMatchObject({ kind: "drafted" });

    const candidate = await draftForAction(demo.id, actionId, { ai, now: () => NOW, purpose: "candidate" });
    expect(candidate).toEqual({ kind: "blocked", reason: "off_limits", note: BLOCK_NOTES.off_limits(exec!.company) });
    // The client check-in is untouched: still a client approach, not blocked, one draft.
    expect(await actionRow(actionId)).toMatchObject({ purpose: "client", blockedReason: null, status: "drafted" });

  });

  it("merges a second change for the same person within 7 days into the open action", async () => {
    const personId = await usPerson();
    const first = await inDemo(async (tx) => createActionForSignal(tx, await confirmedSignal(tx, personId), NOW));
    const secondSignal = await inDemo((tx) => confirmedSignal(tx, personId, { priority: 2, headline: "A second change a day later" }));
    const second = await inDemo((tx) => createActionForSignal(tx, secondSignal, new Date(NOW.getTime() + 86_400_000)));
    expect(second).toEqual({ actionId: first!.actionId, needsDraft: false, merged: true });
    expect((await actionRow(first!.actionId)).mergedSignalIds).toEqual([secondSignal.id]);
    expect(await inDemo(async (tx) => (await tx.select({ n: count() }).from(s.actions).where(eq(s.actions.personId, personId)))[0]!.n)).toBe(1);
    // Eight days later it is a new action.
    const later = await inDemo(async (tx) => createActionForSignal(tx, await confirmedSignal(tx, personId), new Date(NOW.getTime() + 8 * 86_400_000)));
    expect(later!.actionId).not.toBe(first!.actionId);
  });

  it("creates nothing for a person who must not be contacted", async () => {
    const personId = await usPerson();
    await inDemo((tx) => tx.update(s.persons).set({ status: "do_not_contact" }).where(eq(s.persons.id, personId)));
    expect(await inDemo(async (tx) => createActionForSignal(tx, await confirmedSignal(tx, personId), NOW))).toBeNull();
  });
});

describe("drafting, approval and sending (BRD 12.4, 12.5)", () => {
  let actionId: string;
  let personId: string;

  beforeAll(async () => {
    personId = await usPerson();
    const created = await inDemo(async (tx) => createActionForSignal(tx, await confirmedSignal(tx, personId), NOW));
    actionId = created!.actionId;
    expect(await draftForAction(demo.id, actionId, { ai, now: () => NOW })).toMatchObject({ kind: "drafted" });
  });

  it("an outreach owner edits and submits; only a partner approves; the partner approves and sends from their mailbox", async () => {
    const draft = await latestDraft(actionId);
    expect(draft).toMatchObject({ channel: "email", author: "ai", version: 1 });
    expect(draft.rationale).toBeTruthy();

    const saved = await inDemo((tx) => saveDraft(tx, actors.outreach_owner, actionId, { subject: "Congratulations on the new role", body: `${draft.body}\n\nWith best wishes.` }));
    expect(saved).toEqual({ version: 2, changed: true });
    expect(await inDemo((tx) => saveDraft(tx, actors.outreach_owner, actionId, { subject: "Congratulations on the new role", body: `${draft.body}\n\nWith best wishes.` }))).toEqual({ version: 2, changed: false });
    expect(await latestDraft(actionId)).toMatchObject({ author: "user", version: 2 });
    expect(await flowError(inDemo((tx) => saveDraft(tx, actors.validator, actionId, { subject: "x", body: "y" })))).toBe("forbidden");

    await inDemo((tx) => submitForApproval(tx, actors.outreach_owner, actionId));
    expect((await actionRow(actionId)).status).toBe("awaiting_approval");
    expect(await flowError(inDemo((tx) => approveDraft(tx, actors.outreach_owner, actionId)))).toBe("forbidden");
    expect(await flowError(sendAction(actors.outreach_owner, actionId, { sender: mockMailboxSender(), now: NOW }))).toBe("not_approved");

    const { personName } = await approveAndSend(actors.partner, actionId, { sender: mockMailboxSender(), now: NOW });
    expect(personName).toBeTruthy();
    expect(await actionRow(actionId)).toMatchObject({ status: "sent" });
    const sent = await latestDraft(actionId);
    expect(sent).toMatchObject({ version: 2, approvedBy: actors.partner.userId, sentFromUserId: actors.partner.userId });
    expect(sent.providerMessageId).toMatch(/^mock-msg-/);
    const [interaction] = await inDemo((tx) => tx.select().from(s.interactions).where(and(eq(s.interactions.personId, personId), eq(s.interactions.externalId, sent.providerMessageId!))));
    expect(interaction).toMatchObject({ channel: "email", direction: "outbound", ourUserId: actors.partner.userId, provider: "mock", capturedBy: "auto", subject: "Congratulations on the new role" });
    expect(interaction!.threadKey).toMatch(/^mock-conv-/);

    await inDemo((tx) => recordOutcome(tx, actors.outreach_owner, actionId, "replied", NOW));
    expect(await actionRow(actionId)).toMatchObject({ outcome: "replied" });
    const audits = await inDemo((tx) => tx.select({ action: s.auditLog.action }).from(s.auditLog).where(and(eq(s.auditLog.entityType, "action"), eq(s.auditLog.entityId, actionId))));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["action.created", "draft.generated", "draft.edited", "action.submitted", "action.approved", "action.sent", "action.outcome"]));
  });

  it("an edit after approval needs approving again, and the daily send limit holds", async () => {
    const p = await usPerson([personId]);
    const created = await inDemo(async (tx) => createActionForSignal(tx, await confirmedSignal(tx, p), NOW));
    await draftForAction(demo.id, created!.actionId, { ai, now: () => NOW });
    await inDemo((tx) => approveDraft(tx, actors.partner, created!.actionId, NOW));
    const d = await latestDraft(created!.actionId);
    await inDemo((tx) => saveDraft(tx, actors.outreach_owner, created!.actionId, { subject: d.subject, body: `${d.body} Edited.` }));
    expect((await actionRow(created!.actionId)).status).toBe("drafted");
    expect(await flowError(sendAction(actors.outreach_owner, created!.actionId, { sender: mockMailboxSender(), now: NOW }))).toBe("not_approved");

    // One email already went out from the partner's mailbox today; set the limit to 1.
    await inDemo((tx) => tx.update(s.workspaces).set({ settings: sql`jsonb_set(${s.workspaces.settings}, '{send,max_per_day}', '1')` }).where(eq(s.workspaces.id, demo.id)));
    await inDemo((tx) => approveDraft(tx, actors.partner, created!.actionId, NOW));
    expect(await flowError(sendAction(actors.outreach_owner, created!.actionId, { sender: mockMailboxSender(), now: NOW }))).toBe("rate_limit");
    await inDemo((tx) => tx.update(s.workspaces).set({ settings: sql`jsonb_set(${s.workspaces.settings}, '{send,max_per_day}', '25')` }).where(eq(s.workspaces.id, demo.id)));
    await sendAction(actors.outreach_owner, created!.actionId, { sender: mockMailboxSender(), now: NOW });
    expect((await actionRow(created!.actionId)).status).toBe("sent");
  });

  it("a provider failure keeps the draft and the error; the action stays approved", async () => {
    const p = await usPerson([personId]);
    const created = await inDemo(async (tx) => createActionForSignal(tx, await confirmedSignal(tx, p), NOW));
    await draftForAction(demo.id, created!.actionId, { ai, now: () => NOW });
    const failing = { send: async () => { throw new Error("503 from provider"); } };
    expect(await flowError(approveAndSend(actors.partner, created!.actionId, { sender: failing, now: NOW }))).toBe("send_failed");
    expect(await actionRow(created!.actionId)).toMatchObject({ status: "approved" });
    expect((await latestDraft(created!.actionId)).sendError).toContain("503");
  });

  it("LinkedIn drafts are marked sent by hand: an outreach owner needs approval first, a partner does not", async () => {
    const p = await usPerson([personId]);
    const created = await inDemo(async (tx) => createActionForSignal(tx, await confirmedSignal(tx, p), NOW));
    expect(await draftForAction(demo.id, created!.actionId, { ai, now: () => NOW, channel: "linkedin_message" })).toMatchObject({ kind: "drafted" });
    expect((await latestDraft(created!.actionId)).subject).toBeNull();
    expect(await flowError(sendAction(actors.partner, created!.actionId, { sender: mockMailboxSender(), now: NOW }))).toBe("wrong_channel");
    expect(await flowError(inDemo((tx) => markLinkedinSent(tx, actors.outreach_owner, created!.actionId, NOW)))).toBe("not_approved");
    await inDemo((tx) => markLinkedinSent(tx, actors.partner, created!.actionId, NOW));
    expect(await actionRow(created!.actionId)).toMatchObject({ status: "sent" });
    const [i] = await inDemo((tx) => tx.select().from(s.interactions).where(and(eq(s.interactions.personId, p), eq(s.interactions.channel, "linkedin_message"), eq(s.interactions.provider, "manual"))));
    expect(i).toMatchObject({ direction: "outbound", capturedBy: "manual" });
  });

  it("dismissing needs a reason from the list", async () => {
    const p = await usPerson([personId]);
    const created = await inDemo(async (tx) => createActionForSignal(tx, await confirmedSignal(tx, p), NOW));
    expect(await flowError(inDemo((tx) => dismissAction(tx, actors.partner, created!.actionId, "")))).toBe("no_reason");
    await inDemo((tx) => dismissAction(tx, actors.partner, created!.actionId, "wrong_timing"));
    expect(await actionRow(created!.actionId)).toMatchObject({ status: "dismissed", dismissReason: "wrong_timing" });
    expect(await flowError(inDemo((tx) => dismissAction(tx, actors.partner, created!.actionId, "not_relevant")))).toBe("closed");
  });
});

describe("service levels, alerts and the digest (BRD 12.8)", () => {
  it("escalates an action overdue by one working day, once", async () => {
    const p = await usPerson();
    const created = await inDemo(async (tx) => createActionForSignal(tx, await confirmedSignal(tx, p), NOW));
    await inDemo((tx) => tx.update(s.actions).set({ dueAt: new Date("2026-09-25T21:00:00Z") }).where(eq(s.actions.id, created!.actionId)));
    const first = await runSla(demo.id, NOW);
    expect(first.escalated).toBeGreaterThanOrEqual(1);
    expect((await actionRow(created!.actionId)).escalatedAt).toEqual(NOW);
    expect((await runSla(demo.id, NOW)).escalated).toBe(0);
  });

  it("emails the owner about a priority 1 change on a warm relationship", async () => {
    const p = await usPerson();
    await inDemo((tx) => tx.insert(s.relationshipScores).values({ workspaceId: demo.id, personId: p, userId: null, score: 55, band: "warm", factors: {} }));
    const signal = await inDemo((tx) => confirmedSignal(tx, p, { headline: "Warm contact named chief executive" }));
    expect(await inDemo((tx) => createActionForSignal(tx, signal, NOW))).toBeTruthy();
    const [n] = await inDemo((tx) => tx.select().from(s.notifications).where(sql`${s.notifications.dedupeKey} like ${`p1_change:${signal.id}:%`}`));
    expect(n).toMatchObject({ kind: "p1_change", status: "queued", userId: actors.partner.userId });
    expect(n!.bodyText).toContain("warm relationship");
    const sentTo: string[] = [];
    const mailer: Mailer = { mode: "mock", send: async (m) => (sentTo.push(m.to), { messageId: "test" }) };
    expect((await deliverQueued(demo.id, { mailer, now: NOW })).sent).toBeGreaterThanOrEqual(1);
    expect(sentTo).toContain(n!.toEmail);
    expect((await inDemo((tx) => tx.select().from(s.notifications).where(eq(s.notifications.id, n!.id))))[0]).toMatchObject({ status: "sent", providerMessageId: "test" });
  });

  it("emails the partner and data steward when auto-confirm is suspended, once", async () => {
    await inDemo((tx) => alertAutoConfirmSuspended(tx, demo.id, "SEC filing", "sec_8k", "2026-09-30T12:00:00.000Z"));
    await inDemo((tx) => alertAutoConfirmSuspended(tx, demo.id, "SEC filing", "sec_8k", "2026-09-30T12:00:00.000Z"));
    const rows = await inDemo((tx) => tx.select({ userId: s.notifications.userId }).from(s.notifications).where(eq(s.notifications.kind, "auto_confirm_suspended")));
    expect(rows.map((r) => r.userId).sort()).toEqual([actors.partner.userId, actors.data_steward.userId].sort());
  });

  it("scenario 21: a user with no actions, drafts, changes, meetings or quiet alerts gets no digest", async () => {
    const result = await runDigest(harbor.id, { now: NOW, mailer: { mode: "mock", send: async () => ({ messageId: "x" }) } });
    expect(result.queued).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
    const [n] = await withWorkspace(harbor.id, (tx) => tx.select({ n: count() }).from(s.notifications).where(eq(s.notifications.kind, "digest")));
    expect(n!.n).toBe(0);
  });

  it("sends each member with something to do one digest a day, sections in order", async () => {
    const mailer: Mailer = { mode: "mock", send: async () => ({ messageId: "digest" }) };
    const first = await runDigest(demo.id, { now: NOW, mailer });
    expect(first.queued).toBeGreaterThanOrEqual(1);
    const [partnerDigest] = await inDemo((tx) => tx.select().from(s.notifications).where(and(eq(s.notifications.kind, "digest"), eq(s.notifications.userId, actors.partner.userId))));
    expect(partnerDigest).toMatchObject({ status: "sent" });
    expect(partnerDigest!.bodyText).toContain("Actions due today and overdue");
    expect(partnerDigest!.bodyText).toContain("Escalated:");
    expect(partnerDigest!.bodyText).not.toMatch(/[\u2013\u2014]/);
    const again = await runDigest(demo.id, { now: NOW, mailer });
    expect(again.queued).toBe(0);
    const [total] = await inDemo((tx) => tx.select({ n: count() }).from(s.notifications).where(and(eq(s.notifications.kind, "digest"), inArray(s.notifications.userId, [actors.partner.userId]))));
    expect(total!.n).toBe(1);
  });
});
