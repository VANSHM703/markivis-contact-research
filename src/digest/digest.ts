/**
 * The daily digest (BRD 12.8), one email per member at the workspace digest time. Sections in
 * the BRD order; empty sections are left out, and with every section empty no digest is sent
 * (acceptance scenario 21). One digest per member and local day: re-running the job is safe.
 */
import { and, asc, desc, eq, gte, inArray, lte, max, min, sql } from "drizzle-orm";
import { withWorkspace, type Tx } from "@/db/client";
import { actions, calendarEvents, drafts, notifications, persons, queueItems, signals, users, workspaceMembers, workspaces } from "@/db/schema";
import type { WorkspaceRole } from "@/config/navigation";
import { OPEN_STATUSES } from "@/domain/actions";
import { bandFor, isWarmOrStrong } from "@/domain/relationships";
import { formatDateIn, formatTimeIn } from "@/lib/format/labels";
import { can } from "@/lib/permissions";
import { execSearchOn } from "@/lib/packs";
import { describeRule, EXPIRY_REMINDER_DAYS, rulesEndingSoon } from "@/domain/off-limits";
import { addWorkingDays, endOfLocalDay, escalatesAt, localDate, workingDaysBetween } from "@/lib/working-days";
import { appLink, deliverQueued, EMAIL_FOOTER, queueNotification } from "@/mail/notify";
import type { Mailer } from "@/mail/mailer";

export interface DigestSection {
  key: "actions" | "approvals" | "p1_changes" | "meetings" | "quiet" | "queue" | "outcomes" | "off_limits";
  title: string;
  lines: string[];
}

export interface ComposedDigest {
  subject: string;
  text: string;
}

/** Pure: the email for the non-empty sections, or null when there is nothing to say. */
export function composeDigest(workspaceName: string, dateLabel: string, sections: DigestSection[]): ComposedDigest | null {
  const present = sections.filter((s) => s.lines.length > 0);
  if (present.length === 0) return null;
  const body = present.map((s) => `${s.title} (${s.lines.length})\n${s.lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n");
  return {
    subject: `Your day in ${workspaceName}: ${dateLabel}`,
    text: `${body}\n\nOpen Today: ${appLink("/")}${EMAIL_FOOTER}`,
  };
}

export interface DigestMember {
  userId: string;
  email: string;
  name: string;
  role: WorkspaceRole;
}

const OUTCOME_PROMPT_DAYS = 14;

/** Gathers the sections for one member. `since` is the member's previous digest. */
export async function gatherSections(tx: Tx, member: DigestMember, timeZone: string, workingDays: string[] | undefined, since: Date, now: Date, packOn = false): Promise<DigestSection[]> {
  const endOfToday = endOfLocalDay(now, timeZone);
  const date = (d: Date) => formatDateIn(d, timeZone);

  // 1. Actions due today and overdue, escalated first.
  const due = await tx
    .select({ id: actions.id, dueAt: actions.dueAt, headline: sql<string>`coalesce(${actions.headline}, (select s.headline from dmi.signals s where s.id = ${actions.signalId}))`, person: persons.fullName, priority: sql<number | null>`(select s.priority from dmi.signals s where s.id = ${actions.signalId})` })
    .from(actions)
    .leftJoin(persons, eq(persons.id, actions.personId))
    .where(and(eq(actions.ownerUserId, member.userId), inArray(actions.status, [...OPEN_STATUSES]), lte(actions.dueAt, endOfToday)))
    .orderBy(asc(actions.dueAt));
  const actionLines = due
    .map((a) => {
      const escalated = now >= escalatesAt(a.dueAt, timeZone, workingDays);
      const when = a.dueAt < now ? `overdue since ${date(a.dueAt)}` : "due today";
      return { escalated, line: `${escalated ? "Escalated: " : ""}${a.priority ? `P${a.priority} ` : ""}${a.person ?? "No contact yet"}: ${a.headline ?? "Action"} (${when}) ${appLink(`/actions?id=${a.id}`)}` };
    })
    .sort((x, y) => Number(y.escalated) - Number(x.escalated))
    .map((x) => x.line);

  // 2. Drafts awaiting approval: all of them for approvers, otherwise the member's own.
  const awaiting = await tx
    .select({ id: actions.id, person: persons.fullName })
    .from(actions)
    .leftJoin(persons, eq(persons.id, actions.personId))
    .where(and(eq(actions.status, "awaiting_approval"), can(member.role, "drafts.approve") ? undefined : eq(actions.ownerUserId, member.userId)))
    .orderBy(asc(actions.dueAt));
  const approvalLines = awaiting.map((a) => `Message to ${a.person ?? "a contact"} ${appLink(`/actions?id=${a.id}`)}`);

  // 3. Priority 1 changes on strong or warm relationships since the last digest.
  const p1 = await tx
    .select({ id: signals.id, headline: signals.headline, personId: signals.personId })
    .from(signals)
    .where(and(eq(signals.status, "confirmed"), eq(signals.priority, 1), gte(signals.confirmedAt, since), sql`${signals.personId} is not null`))
    .orderBy(desc(signals.confirmedAt));
  const p1Lines: string[] = [];
  for (const s of p1) {
    const band = await bandFor(tx, s.personId!, member.userId);
    if (isWarmOrStrong(band?.band)) p1Lines.push(`${s.headline} (${band!.band} relationship)`);
  }

  // 4. Meetings in the next 24 hours, with their briefs.
  const meetings = await tx
    .select({ title: calendarEvents.title, startsAt: calendarEvents.startsAt, briefId: calendarEvents.briefId, personIds: calendarEvents.personIds })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.userId, member.userId), gte(calendarEvents.startsAt, now), lte(calendarEvents.startsAt, new Date(now.getTime() + 24 * 3_600_000)), sql`cardinality(${calendarEvents.personIds}) > 0`))
    .orderBy(asc(calendarEvents.startsAt));
  const meetingLines = meetings.map((m) => `${formatTimeIn(m.startsAt, timeZone)}: ${m.title ?? "Meeting"}${m.briefId ? `. Brief: ${appLink(`/people/${m.personIds[0]}?brief=${m.briefId}`)}` : `. ${appLink(`/people/${m.personIds[0]}`)}`}`);

  // 5. Going-quiet alerts since the last digest on the member's relationships.
  const quiet = await tx
    .select({ headline: signals.headline, personId: signals.personId })
    .from(signals)
    .innerJoin(persons, eq(persons.id, signals.personId))
    .where(and(eq(signals.type, "internal_relationship_quiet"), eq(signals.status, "confirmed"), gte(signals.confirmedAt, since), eq(persons.relationshipOwnerId, member.userId)));
  const quietLines = quiet.map((q) => `${q.headline} ${appLink(`/people/${q.personId}`)}`);

  // 6. Validation queue count and oldest age, for validators.
  const queueLines: string[] = [];
  if (member.role === "validator") {
    const [sig] = await tx.select({ n: sql<number>`count(*)::int`, oldest: min(signals.foundAt) }).from(signals).where(eq(signals.status, "pending"));
    const [items] = await tx.select({ n: sql<number>`count(*)::int`, oldest: min(queueItems.createdAt) }).from(queueItems).where(eq(queueItems.status, "pending"));
    const total = (sig?.n ?? 0) + (items?.n ?? 0);
    const oldest = [sig?.oldest, items?.oldest].filter((d): d is Date => d instanceof Date).sort((a, b) => a.getTime() - b.getTime())[0];
    if (total > 0) {
      const age = oldest ? workingDaysBetween(oldest, now) : 0;
      const [old] = await tx.select({ n: sql<number>`count(*)::int` }).from(signals).where(and(eq(signals.status, "pending"), lte(signals.foundAt, addWorkingDays(now, -3, timeZone, workingDays))));
      queueLines.push(`${total} ${total === 1 ? "item" : "items"} waiting; the oldest is ${age} working ${age === 1 ? "day" : "days"} old ${appLink("/queue")}`);
      if ((old?.n ?? 0) > 0) queueLines.push(`${old!.n} ${old!.n === 1 ? "item is" : "items are"} older than 3 working days, over target`);
    }
  }

  // 7. Outcomes to record, 14 days after sending (BRD 12.7).
  const sent = await tx
    .select({ id: actions.id, person: persons.fullName, sentAt: max(drafts.sentAt) })
    .from(actions)
    .innerJoin(drafts, eq(drafts.actionId, actions.id))
    .leftJoin(persons, eq(persons.id, actions.personId))
    .where(and(eq(actions.ownerUserId, member.userId), inArray(actions.status, ["sent", "done"]), eq(actions.outcome, "none")))
    .groupBy(actions.id, persons.fullName);
  const cutoff = new Date(now.getTime() - OUTCOME_PROMPT_DAYS * 86_400_000);
  const outcomeLines = sent.filter((a) => a.sentAt && a.sentAt <= cutoff).map((a) => `Message to ${a.person ?? "a contact"}, sent ${date(a.sentAt!)}: how did it go? ${appLink(`/actions?id=${a.id}`)}`);

  // 8. Executive search pack: each off-limits rule once, 30 days before it ends (BRD 13).
  const offLimitsLines: string[] = [];
  if (packOn && can(member.role, "off_limits.set")) {
    const today = localDate(now, timeZone);
    const sinceDay = localDate(since, timeZone);
    for (const r of await rulesEndingSoon(tx, today)) {
      const remindOn = new Date(new Date(`${r.endsOn}T00:00:00Z`).getTime() - EXPIRY_REMINDER_DAYS * 86_400_000).toISOString().slice(0, 10);
      if (remindOn > sinceDay && remindOn <= today) offLimitsLines.push(`${r.companyName}, ${describeRule(r).toLowerCase()}: ends ${formatDateIn(new Date(`${r.endsOn}T12:00:00Z`), "UTC")}. Extend or let it lapse ${appLink("/settings/off-limits")}`);
    }
  }

  return [
    { key: "actions", title: "Actions due today and overdue", lines: actionLines },
    { key: "approvals", title: "Drafts awaiting approval", lines: approvalLines },
    { key: "p1_changes", title: "Priority 1 changes on strong or warm relationships", lines: p1Lines },
    { key: "meetings", title: "Meetings in the next 24 hours", lines: meetingLines },
    { key: "quiet", title: "Going quiet", lines: quietLines },
    { key: "queue", title: "Validation queue", lines: queueLines },
    { key: "outcomes", title: "Outcomes to record", lines: outcomeLines },
    { key: "off_limits", title: "Off-limits rules ending within 30 days", lines: offLimitsLines },
  ];
}

export interface DigestRun {
  queued: number;
  skipped: number;
  sent: number;
}

/** Builds and queues today's digest for every active member, then delivers it. */
export async function runDigest(workspaceId: string, options: { now?: Date; mailer?: Mailer } = {}): Promise<DigestRun> {
  const now = options.now ?? new Date();
  const result = await withWorkspace(workspaceId, async (tx) => {
    const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const settings = ws!.settings as { working_days?: string[] };
    const members = await tx
      .select({ userId: users.id, email: users.email, name: users.name, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.status, "active"));
    const today = localDate(now, ws!.timezone);
    let queued = 0;
    let skipped = 0;
    for (const member of members) {
      const dedupeKey = `digest:${member.userId}:${today}`;
      const [already] = await tx.select({ id: notifications.id }).from(notifications).where(eq(notifications.dedupeKey, dedupeKey)).limit(1);
      if (already) continue;
      const [last] = await tx
        .select({ at: notifications.createdAt })
        .from(notifications)
        .where(and(eq(notifications.userId, member.userId), eq(notifications.kind, "digest")))
        .orderBy(desc(notifications.createdAt))
        .limit(1);
      const since = last?.at ?? new Date(now.getTime() - 24 * 3_600_000);
      const sections = await gatherSections(tx, member, ws!.timezone, settings.working_days, since, now, execSearchOn(ws));
      const digest = composeDigest(ws!.name, formatDateIn(now, ws!.timezone), sections);
      if (!digest) {
        skipped++;
        continue;
      }
      await queueNotification(tx, { workspaceId, userId: member.userId, toEmail: member.email, kind: "digest", dedupeKey, subject: digest.subject, bodyText: digest.text });
      queued++;
    }
    return { queued, skipped };
  });
  const delivered = await deliverQueued(workspaceId, { mailer: options.mailer, now });
  return { ...result, sent: delivered.sent };
}
