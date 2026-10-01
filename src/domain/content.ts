/**
 * Topic vocabulary and content library (BRD 14, P0). One workspace list of topics, used by
 * newsletter links, content items and person interests; and the partner's thought papers,
 * newsletter issues and interview clips, entered by form or CSV (title, url, topics,
 * published_on, description), which drafts suggest when the topics overlap a person's interests.
 */
import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { contentItems, workspaces } from "@/db/schema";
import { DEFAULT_TOPICS } from "@/config/workspace-defaults";
import { audit } from "@/lib/audit";
import { parseCsv } from "./imports/csv";
import type { RowIssue } from "./imports/target-list";

export class ContentError extends Error {}

export const MAX_TOPICS = 40;

interface Actor {
  workspaceId: string;
  userId: string;
}

export function topicsOf(settings: unknown): string[] {
  const topics = (settings as { topics?: unknown } | null)?.topics;
  return Array.isArray(topics) && topics.every((t) => typeof t === "string") ? (topics as string[]) : [...DEFAULT_TOPICS];
}

/** One topic per line; blank lines and repeats (ignoring case) are dropped. */
export function parseTopics(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const topic = line.trim().replace(/\s+/g, " ");
    if (!topic || seen.has(topic.toLowerCase())) continue;
    seen.add(topic.toLowerCase());
    out.push(topic);
  }
  return out;
}

export async function saveTopics(tx: Tx, actor: Actor, topics: string[]): Promise<void> {
  if (topics.length === 0 || topics.length > MAX_TOPICS || topics.some((t) => t.length < 2 || t.length > 60)) throw new ContentError(`Enter 1 to ${MAX_TOPICS} topics, one per line, each 2 to 60 characters.`);
  const [ws] = await tx.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, actor.workspaceId)).limit(1);
  const before = ws!.settings as Record<string, unknown>;
  await tx.update(workspaces).set({ settings: { ...before, topics } }).where(eq(workspaces.id, actor.workspaceId));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "settings.topics_changed", entityType: "workspace", entityId: actor.workspaceId, before: { topics: topicsOf(before) }, after: { topics } });
}

export interface ContentInput {
  title: string;
  url: string | null;
  topics: string[];
  publishedOn: string | null;
  description: string | null;
}

const URL_RE = /^https?:\/\/[^\s]+$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Problems with one item, as field and message. Topics must come from the vocabulary. */
export function checkContent(input: ContentInput, vocabulary: string[]): RowIssue[] {
  const issues: RowIssue[] = [];
  const known = new Map(vocabulary.map((t) => [t.toLowerCase(), t]));
  if (!input.title || input.title.length > 200) issues.push({ column: "title", message: "Give a title of up to 200 characters." });
  if (input.url && !URL_RE.test(input.url)) issues.push({ column: "url", message: "Use a full web address starting with https://." });
  if (input.publishedOn && (!DATE_RE.test(input.publishedOn) || Number.isNaN(Date.parse(input.publishedOn)))) issues.push({ column: "published_on", message: "Use a date like 2026-09-15." });
  if (input.description && input.description.length > 500) issues.push({ column: "description", message: "Keep the description to 500 characters." });
  const unknown = input.topics.filter((t) => !known.has(t.toLowerCase()));
  if (unknown.length) issues.push({ column: "topics", message: `Not in the topic list: ${unknown.join(", ")}. Add them to the list first, or leave them out.` });
  if (input.topics.length === 0) issues.push({ column: "topics", message: "Choose at least one topic, so drafts can match it to people's interests." });
  return issues;
}

export async function addContentItem(tx: Tx, actor: Actor, input: ContentInput, vocabulary: string[]): Promise<string> {
  const issues = checkContent(input, vocabulary);
  if (issues.length) throw new ContentError(issues.map((i) => i.message).join(" "));
  const known = new Map(vocabulary.map((t) => [t.toLowerCase(), t]));
  const [row] = await tx
    .insert(contentItems)
    .values({ workspaceId: actor.workspaceId, title: input.title, url: input.url, topics: input.topics.map((t) => known.get(t.toLowerCase())!), publishedOn: input.publishedOn, description: input.description })
    .returning({ id: contentItems.id });
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "content.added", entityType: "content_item", entityId: row!.id, after: { title: input.title, topics: input.topics } });
  return row!.id;
}

export async function removeContentItem(tx: Tx, actor: Actor, id: string): Promise<void> {
  const [row] = await tx.delete(contentItems).where(eq(contentItems.id, id)).returning({ id: contentItems.id, title: contentItems.title });
  if (row) await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "content.removed", entityType: "content_item", entityId: id, before: { title: row.title } });
}

// ---------------------------------------------------------------------------------------------
// CSV import, previewed before it is committed (BRD 16.4)
// ---------------------------------------------------------------------------------------------

export const CONTENT_COLUMNS = ["title", "url", "topics", "published_on", "description"] as const;

export interface ContentPreviewRow {
  rowNumber: number;
  item: ContentInput;
  issues: RowIssue[];
}

export function contentTemplate(): string {
  return "title,url,topics,published_on,description\r\nThe CEO succession playbook,https://example.com/insights/ceo-succession,CEO succession; Board composition,2026-09-01,What boards get wrong when the CEO leaves.\r\n";
}

/** Parses a content library CSV. Topics are separated by semicolons. */
export function previewContent(text: string, vocabulary: string[]): { rows: ContentPreviewRow[]; unknownColumns: string[] } {
  const parsed = parseCsv(text);
  if (parsed.rows.length === 0) throw new ContentError("The file has no rows under the header.");
  if (parsed.rows.length > 2000) throw new ContentError("Import at most 2,000 items at a time.");
  if (!parsed.headers.includes("title")) throw new ContentError("The file needs a title column. Download the template for the columns.");
  const unknownColumns = parsed.headers.filter((h) => h && !(CONTENT_COLUMNS as readonly string[]).includes(h));
  const rows = parsed.rows.map((r, i) => {
    const get = (key: string) => r[key]?.trim() || null;
    const item: ContentInput = {
      title: get("title") ?? "",
      url: get("url"),
      topics: (get("topics") ?? "").split(";").map((t) => t.trim()).filter(Boolean),
      publishedOn: get("published_on"),
      description: get("description"),
    };
    return { rowNumber: parsed.rowNumbers[i]!, item, issues: checkContent(item, vocabulary) };
  });
  return { rows, unknownColumns };
}

export async function commitContent(tx: Tx, actor: Actor, rows: ContentPreviewRow[], vocabulary: string[]): Promise<{ created: number; rejected: { rowNumber: number; reason: string }[] }> {
  let created = 0;
  const rejected: { rowNumber: number; reason: string }[] = [];
  for (const row of rows) {
    const issues = checkContent(row.item, vocabulary);
    if (issues.length) {
      rejected.push({ rowNumber: row.rowNumber, reason: issues.map((i) => i.message).join(" ") });
      continue;
    }
    await addContentItem(tx, actor, row.item, vocabulary);
    created++;
  }
  return { created, rejected };
}
