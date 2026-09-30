/**
 * Capture runs (BRD 11.1 to 11.3, 8.9 capture.mail and capture.calendar): for each active
 * connection, fetch the mail delta or the calendar window, resolve every address against tracked
 * people's role emails (current and past), and create interactions only for messages and events
 * that involve a tracked person. Everything else is dropped in memory: no row, no log line,
 * nothing about it is stored (acceptance scenario 11). Idempotent on the provider's ids.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { withWorkspace, type Tx } from "@/db/client";
import { calendarEvents, captureExclusions, interactions, oauthConnections, persons, privacyMarks, roles, users, workspaces } from "@/db/schema";
import { HttpError, type HttpClient } from "@/ingest/http";
import { log } from "@/lib/log";
import { providerFor, type Connection } from "./connections";
import type { CapturedEvent, CapturedMessage, CaptureProviderName } from "./types";

const DAY = 86_400_000;
export const MAIL_BACKFILL_DAYS = 365;
export const CALENDAR_PAST_DAYS = 30;
export const CALENDAR_AHEAD_DAYS = 14;

export interface AddressIndex {
  byEmail: Map<string, { personId: string; roleId: string }>;
}

/** Every role email of every tracked person, past and current, lowercased. */
export async function addressIndex(tx: Tx): Promise<AddressIndex> {
  const rows = await tx
    .select({ email: roles.businessEmail, personId: roles.personId, roleId: roles.id, status: roles.status })
    .from(roles)
    .innerJoin(persons, eq(persons.id, roles.personId))
    .where(and(eq(persons.isTracked, true), isNull(persons.mergedIntoId)));
  const byEmail = new Map<string, { personId: string; roleId: string }>();
  // Current roles win over past ones for the same address.
  for (const r of rows.sort((a, b) => Number(b.status === "current") - Number(a.status === "current"))) {
    const email = r.email?.toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, { personId: r.personId, roleId: r.roleId });
  }
  return { byEmail };
}

/** An exclusion is an address (`jane@example.com`) or a domain (`example.com` or `@example.com`). */
export function isExcluded(address: string, patterns: string[]): boolean {
  const a = address.toLowerCase();
  const domain = a.split("@")[1] ?? "";
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (p.includes("@") && !p.startsWith("@")) return p === a;
    const d = p.replace(/^@/, "");
    return domain === d || domain.endsWith(`.${d}`);
  });
}

export interface MessageMatch {
  personId: string;
  roleId: string;
  direction: "outbound" | "inbound";
}

/** The tracked people a message involves, other than our own addresses and excluded ones. Pure. */
export function matchMessage(message: CapturedMessage, index: AddressIndex, ours: Set<string>, exclusions: string[]): MessageMatch[] {
  const outbound = !!message.from && ours.has(message.from);
  const seen = new Set<string>();
  const out: MessageMatch[] = [];
  for (const address of [message.from, ...message.to, ...message.cc]) {
    if (!address || ours.has(address) || isExcluded(address, exclusions)) continue;
    const hit = index.byEmail.get(address);
    if (!hit || seen.has(hit.personId)) continue;
    seen.add(hit.personId);
    out.push({ ...hit, direction: outbound ? "outbound" : "inbound" });
  }
  return out;
}

async function privacy(tx: Tx): Promise<{ threads: Set<string>; people: Set<string> }> {
  const marks = await tx.select({ kind: privacyMarks.kind, key: privacyMarks.key }).from(privacyMarks);
  return { threads: new Set(marks.filter((m) => m.kind === "thread").map((m) => m.key)), people: new Set(marks.filter((m) => m.kind === "person").map((m) => m.key)) };
}

async function context(tx: Tx, c: Connection) {
  const [user] = await tx.select({ email: users.email }).from(users).where(eq(users.id, c.userId)).limit(1);
  const ours = new Set([c.accountEmail, user?.email].filter((e): e is string => !!e).map((e) => e.toLowerCase()));
  const exclusions = (await tx.select({ pattern: captureExclusions.pattern }).from(captureExclusions).where(eq(captureExclusions.userId, c.userId))).map((e) => e.pattern);
  return { ours, exclusions, index: await addressIndex(tx), marks: await privacy(tx) };
}

export interface MailRunResult {
  messages: number;
  involvingTracked: number;
  created: number;
}

/** Writes the interactions for one delta page and advances the cursor, in one transaction. */
export async function applyMailDelta(tx: Tx, c: Connection, messages: CapturedMessage[], cursor: string, now: Date): Promise<MailRunResult> {
  const ctx = await context(tx, c);
  let involving = 0;
  let created = 0;
  for (const m of messages) {
    const matches = matchMessage(m, ctx.index, ctx.ours, ctx.exclusions);
    if (matches.length === 0) continue;
    involving++;
    for (const match of matches) {
      const rows = await tx
        .insert(interactions)
        .values({
          workspaceId: c.workspaceId,
          personId: match.personId,
          roleId: match.roleId,
          channel: "email",
          direction: match.direction,
          occurredAt: new Date(m.sentAt),
          ourUserId: c.userId,
          subject: m.subject?.slice(0, 500) ?? null,
          threadKey: m.conversationId,
          provider: c.provider,
          externalId: `${m.internetMessageId}|${match.personId}`,
          capturedBy: "auto",
          isPrivate: (!!m.conversationId && ctx.marks.threads.has(m.conversationId)) || ctx.marks.people.has(match.personId),
        })
        .onConflictDoNothing({ target: [interactions.workspaceId, interactions.provider, interactions.externalId] })
        .returning({ id: interactions.id });
      created += rows.length;
    }
  }
  await tx.update(oauthConnections).set({ deltaCursor: cursor, lastSyncAt: now, errorMessage: null, status: "active" }).where(eq(oauthConnections.id, c.id));
  return { messages: messages.length, involvingTracked: involving, created };
}

export interface CalendarRunResult {
  events: number;
  withTracked: number;
  meetings: number;
}

/** Stores events that involve tracked people and logs meetings once they have ended (BRD 11.1). */
export async function applyCalendar(tx: Tx, c: Connection, events: CapturedEvent[], now: Date): Promise<CalendarRunResult> {
  const ctx = await context(tx, c);
  let withTracked = 0;
  let meetings = 0;
  for (const e of events) {
    if (e.cancelled) continue;
    const people = new Map<string, string>();
    for (const address of [e.organizer, ...e.attendees]) {
      if (!address || ctx.ours.has(address) || isExcluded(address, ctx.exclusions)) continue;
      const hit = ctx.index.byEmail.get(address);
      if (hit && !people.has(hit.personId)) people.set(hit.personId, hit.roleId);
    }
    if (people.size === 0) continue;
    withTracked++;
    const personIds = Array.from(people.keys());
    await tx
      .insert(calendarEvents)
      .values({ workspaceId: c.workspaceId, userId: c.userId, provider: c.provider, externalId: e.id, startsAt: new Date(e.startsAt), endsAt: new Date(e.endsAt), title: e.title, attendeeEmails: e.attendees, personIds })
      .onConflictDoUpdate({ target: [calendarEvents.workspaceId, calendarEvents.provider, calendarEvents.externalId], set: { startsAt: new Date(e.startsAt), endsAt: new Date(e.endsAt), title: e.title, attendeeEmails: e.attendees, personIds } });
    if (new Date(e.endsAt) > now) continue;
    for (const [personId, roleId] of people) {
      const rows = await tx
        .insert(interactions)
        .values({
          workspaceId: c.workspaceId, personId, roleId, channel: "meeting", direction: "two_way", occurredAt: new Date(e.startsAt), ourUserId: c.userId,
          subject: e.title?.slice(0, 500) ?? null, provider: c.provider, externalId: `event:${e.id}|${personId}`, capturedBy: "auto", isPrivate: ctx.marks.people.has(personId),
        })
        .onConflictDoNothing({ target: [interactions.workspaceId, interactions.provider, interactions.externalId] })
        .returning({ id: interactions.id });
      meetings += rows.length;
    }
  }
  await tx.update(oauthConnections).set({ calendarSyncedAt: now, errorMessage: null, status: "active" }).where(eq(oauthConnections.id, c.id));
  return { events: events.length, withTracked, meetings };
}

async function activeConnections(workspaceId: string, connectionId?: string): Promise<Connection[]> {
  return withWorkspace(workspaceId, async (tx) => {
    const [ws] = await tx.select({ flags: workspaces.flags }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const flags = (ws?.flags ?? {}) as Record<string, boolean>;
    const enabled = (["microsoft", "google"] as const).filter((p) => flags[`capture.${p}`] !== false);
    if (enabled.length === 0) return [];
    return tx
      .select()
      .from(oauthConnections)
      .where(and(eq(oauthConnections.status, "active"), inArray(oauthConnections.provider, enabled), connectionId ? eq(oauthConnections.id, connectionId) : undefined));
  });
}

async function recordFailure(c: Connection, error: unknown): Promise<string> {
  const auth = error instanceof HttpError && (error.status === 401 || error.status === 403);
  const message = auth ? "The mailbox connection has expired or was revoked. Reconnect it in Settings." : `Sync failed: ${(error as Error).message}`.slice(0, 500);
  await withWorkspace(c.workspaceId, (tx) => tx.update(oauthConnections).set({ errorMessage: message, ...(auth ? { status: "error" as const } : {}) }).where(eq(oauthConnections.id, c.id)));
  log.error("capture.failed", { workspaceId: c.workspaceId, connectionId: c.id, provider: c.provider, error: message });
  return message;
}

export interface CaptureOptions {
  now?: Date;
  connectionId?: string;
  http?: HttpClient;
}

export async function runMailCapture(workspaceId: string, options: CaptureOptions = {}): Promise<{ connections: number; created: number; errors: string[] }> {
  const now = options.now ?? new Date();
  let created = 0;
  const errors: string[] = [];
  const list = await activeConnections(workspaceId, options.connectionId);
  for (const c of list) {
    try {
      const provider = providerFor(c, { http: options.http, now: () => now });
      let cursor = c.deltaCursor;
      for (let round = 0; round < 5; round++) {
        const delta = await provider.mailDelta(cursor, new Date(now.getTime() - MAIL_BACKFILL_DAYS * DAY));
        const result = await withWorkspace(workspaceId, (tx) => applyMailDelta(tx, c, delta.messages, delta.cursor, now));
        created += result.created;
        log.info("capture.mail", { workspaceId, connectionId: c.id, provider: c.provider as CaptureProviderName, messages: result.messages, involvingTracked: result.involvingTracked, created: result.created });
        cursor = delta.cursor;
        if (!delta.more) break;
      }
    } catch (error) {
      errors.push(await recordFailure(c, error));
    }
  }
  return { connections: list.length, created, errors };
}

export async function runCalendarCapture(workspaceId: string, options: CaptureOptions = {}): Promise<{ connections: number; meetings: number; errors: string[] }> {
  const now = options.now ?? new Date();
  let meetings = 0;
  const errors: string[] = [];
  const list = await activeConnections(workspaceId, options.connectionId);
  for (const c of list) {
    try {
      const provider = providerFor(c, { http: options.http, now: () => now });
      const events = await provider.calendarWindow(new Date(now.getTime() - CALENDAR_PAST_DAYS * DAY), new Date(now.getTime() + CALENDAR_AHEAD_DAYS * DAY));
      const result = await withWorkspace(workspaceId, (tx) => applyCalendar(tx, c, events, now));
      meetings += result.meetings;
      log.info("capture.calendar", { workspaceId, connectionId: c.id, events: result.events, withTracked: result.withTracked, meetings: result.meetings });
    } catch (error) {
      errors.push(await recordFailure(c, error));
    }
  }
  return { connections: list.length, meetings, errors };
}
