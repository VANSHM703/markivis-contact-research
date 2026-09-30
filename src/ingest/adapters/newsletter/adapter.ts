/**
 * Newsletter engagement (BRD 8.6), CSV implementation. Columns:
 *   email, event (open | click | unsubscribe | subscribe), occurred_at, issue_title, link_url, topics
 * Each event becomes a raw item; applyNewsletterEvents() then turns them into interactions,
 * consent changes and first-party interests. The HubSpot marketing email implementation is P1.
 */
import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { consents, interactions, personInterests, persons, rawItems, roles } from "@/db/schema";
import { parseCsv } from "@/domain/imports/csv";
import { normaliseEmail } from "@/lib/normalise";
import { readFixture } from "../../fixtures";
import type { Feed, HealthResult, RawItemInput, SourceAdapter, WorkspaceCtx } from "../../types";

export const NEWSLETTER_EVENTS = ["open", "click", "unsubscribe", "subscribe"] as const;
type NewsletterEvent = (typeof NEWSLETTER_EVENTS)[number];

export interface NewsletterRow {
  email: string;
  event: NewsletterEvent;
  occurredAt: Date;
  issueTitle: string | null;
  linkUrl: string | null;
  topics: string[];
}

export class NewsletterCsvError extends Error {}

export function parseNewsletterCsv(text: string): { rows: NewsletterRow[]; rejected: { rowNumber: number; reason: string }[] } {
  const parsed = parseCsv(text);
  for (const required of ["email", "event", "occurred_at"]) {
    if (!parsed.headers.includes(required)) throw new NewsletterCsvError(`The file needs an ${required} column. Expected: email, event, occurred_at, issue_title, link_url, topics.`);
  }
  const rows: NewsletterRow[] = [];
  const rejected: { rowNumber: number; reason: string }[] = [];
  parsed.rows.forEach((r, i) => {
    const rowNumber = parsed.rowNumbers[i]!;
    const email = normaliseEmail(r.email);
    const event = (r.event ?? "").toLowerCase() as NewsletterEvent;
    const occurredAt = new Date(r.occurred_at ?? "");
    if (!email) return rejected.push({ rowNumber, reason: "The email address is not valid." });
    if (!NEWSLETTER_EVENTS.includes(event)) return rejected.push({ rowNumber, reason: `Unknown event "${r.event}". Use open, click, unsubscribe or subscribe.` });
    if (Number.isNaN(occurredAt.getTime())) return rejected.push({ rowNumber, reason: "occurred_at is not a date and time." });
    rows.push({ email, event, occurredAt, issueTitle: r.issue_title || null, linkUrl: r.link_url || null, topics: (r.topics ?? "").split(/[;|]/).map((t) => t.trim()).filter(Boolean) });
  });
  return { rows, rejected };
}

/** `source` supplies the CSV: an uploaded file, or the fixture in mock mode. */
export function createNewsletterAdapter(source: (ctx: WorkspaceCtx) => Promise<string | null>): SourceAdapter {
  return {
    key: "newsletter",
    async *fetch(ctx: WorkspaceCtx, _feed: Feed): AsyncIterable<RawItemInput> {
      const text = await source(ctx);
      if (!text) return;
      for (const row of parseNewsletterCsv(text).rows) {
        const id = createHash("sha256").update(`${row.email}|${row.event}|${row.occurredAt.toISOString()}|${row.linkUrl ?? ""}`).digest("hex").slice(0, 32);
        yield {
          externalId: `newsletter:${id}`,
          url: row.linkUrl,
          title: row.issueTitle,
          publishedAt: row.occurredAt,
          payload: { email: row.email, event: row.event, topics: row.topics, issue_title: row.issueTitle, link_url: row.linkUrl },
          identifies: { emails: [row.email] },
        };
      }
    },
    async healthCheck(): Promise<HealthResult> {
      return { ok: true, message: "CSV uploads are ready. Upload newsletter events in Settings, Sources." };
    },
  };
}

export const fixtureNewsletterSource = (ctx: WorkspaceCtx) => readFixture("newsletter/events.csv", ctx.now);

/** Clicks on one topic within this many days that make it a first-party interest (BRD 8.6). */
export const INTEREST_CLICKS = 3;
export const INTEREST_WINDOW_DAYS = 30;

export interface NewsletterApplyResult {
  interactions: number;
  optOuts: number;
  optIns: number;
  interests: number;
  unmatched: number;
}

/**
 * Applies unprocessed newsletter raw items. Opens are stored but weigh nothing in scoring; an
 * unsubscribe sets newsletter consent to opted_out in the same job; an address that matches no
 * tracked person is ignored (outcome irrelevant) and nothing about it is kept beyond the raw item.
 */
export async function applyNewsletterEvents(ctx: WorkspaceCtx): Promise<NewsletterApplyResult> {
  const result: NewsletterApplyResult = { interactions: 0, optOuts: 0, optIns: 0, interests: 0, unmatched: 0 };
  const pending = await ctx.tx.select().from(rawItems).where(and(eq(rawItems.sourceType, "newsletter"), isNull(rawItems.processedAt))).orderBy(rawItems.publishedAt);
  if (pending.length === 0) return result;

  const emails = [...new Set(pending.map((r) => (r.payload as { email: string }).email))];
  const owners = await ctx.tx
    .selectDistinctOn([roles.businessEmail], { email: roles.businessEmail, personId: roles.personId, roleId: roles.id })
    .from(roles)
    .innerJoin(persons, eq(persons.id, roles.personId))
    .where(and(inArray(roles.businessEmail, emails), isNull(persons.mergedIntoId)))
    .orderBy(roles.businessEmail, sql`${roles.status} = 'current' desc`);
  const byEmail = new Map(owners.map((o) => [o.email!, o]));
  const touchedTopics = new Map<string, Set<string>>();

  for (const item of pending) {
    const p = item.payload as { email: string; event: NewsletterEvent; topics: string[]; issue_title: string | null };
    const owner = byEmail.get(p.email);
    let outcome: "record_updated" | "irrelevant" = "record_updated";
    if (!owner) {
      outcome = "irrelevant";
      result.unmatched++;
    } else if (p.event === "click" || p.event === "open") {
      await ctx.tx
        .insert(interactions)
        .values({
          workspaceId: ctx.workspaceId,
          personId: owner.personId,
          roleId: owner.roleId,
          channel: p.event === "click" ? "newsletter_click" : "newsletter_open",
          direction: "not_applicable",
          occurredAt: item.publishedAt ?? ctx.now,
          subject: p.issue_title,
          provider: "newsletter",
          externalId: item.externalId,
          capturedBy: "import",
          contentTopic: p.topics[0] ?? null,
        })
        .onConflictDoNothing();
      result.interactions++;
      if (p.event === "click") for (const topic of p.topics) touchedTopics.set(owner.personId, (touchedTopics.get(owner.personId) ?? new Set()).add(topic));
    } else {
      const status = p.event === "unsubscribe" ? "opted_out" : "opted_in";
      await ctx.tx
        .insert(consents)
        .values({ workspaceId: ctx.workspaceId, personId: owner.personId, channel: "newsletter", purpose: "newsletter", status, capturedVia: "newsletter platform", proof: `${p.event} event at ${(item.publishedAt ?? ctx.now).toISOString()}`, recordedAt: ctx.now })
        .onConflictDoUpdate({ target: [consents.personId, consents.channel, consents.purpose], set: { status, capturedVia: "newsletter platform", proof: `${p.event} event at ${(item.publishedAt ?? ctx.now).toISOString()}`, recordedAt: ctx.now } });
      if (status === "opted_out") result.optOuts++;
      else result.optIns++;
    }
    await ctx.tx.update(rawItems).set({ processedAt: ctx.now, outcome }).where(eq(rawItems.id, item.id));
  }

  // Three or more clicks on one topic within 30 days make it a first-party interest.
  const since = new Date(ctx.now.getTime() - INTEREST_WINDOW_DAYS * 86_400_000);
  for (const [personId, topics] of touchedTopics) {
    for (const topic of topics) {
      const [{ n } = { n: 0 }] = await ctx.tx
        .select({ n: sql<number>`count(*)::int` })
        .from(rawItems)
        .innerJoin(interactions, and(eq(interactions.externalId, rawItems.externalId), eq(interactions.provider, "newsletter")))
        .where(and(eq(interactions.personId, personId), eq(interactions.channel, "newsletter_click"), gte(interactions.occurredAt, since), sql`${rawItems.payload}->'topics' ? ${topic}`));
      if (n < INTEREST_CLICKS) continue;
      const inserted = await ctx.tx.insert(personInterests).values({ workspaceId: ctx.workspaceId, personId, topic, source: "first_party", capturedAt: ctx.now }).onConflictDoNothing().returning({ id: personInterests.id });
      result.interests += inserted.length;
    }
  }
  return result;
}
