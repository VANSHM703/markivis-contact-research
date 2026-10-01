"use server";

/** Topic vocabulary and content library (BRD 14): form, CSV import with preview, removal. */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/forms/FormState";
import { withWorkspace } from "@/db/client";
import { importBatches, workspaces } from "@/db/schema";
import { addContentItem, commitContent, ContentError, parseTopics, previewContent, removeContentItem, saveTopics, topicsOf, type ContentPreviewRow } from "@/domain/content";
import { CsvError } from "@/domain/imports/csv";
import { MAX_IMPORT_BYTES } from "@/domain/imports/target-list";
import { audit } from "@/lib/audit";
import { getRequestContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { UUID_RE } from "./guards";

const PAGE = "/settings/content";

async function requireSettings() {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!can(ctx.role, "settings.change")) redirect("/?notice=not_allowed");
  return ctx;
}

const actorOf = (ctx: { workspace: { id: string }; user: { id: string } }) => ({ workspaceId: ctx.workspace.id, userId: ctx.user.id });

async function vocabulary(workspaceId: string): Promise<string[]> {
  return withWorkspace(workspaceId, async (tx) => topicsOf((await tx.select({ s: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0]?.s));
}

export async function saveTopicsAction(formData: FormData): Promise<void> {
  const ctx = await requireSettings();
  try {
    await withWorkspace(ctx.workspace.id, (tx) => saveTopics(tx, actorOf(ctx), parseTopics(String(formData.get("topics") ?? ""))));
  } catch (error) {
    if (error instanceof ContentError) redirect(`${PAGE}?notice=topics_invalid`);
    throw error;
  }
  redirect(`${PAGE}?notice=topics_saved`);
}

export async function addContentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireSettings();
  const text = (k: string) => String(formData.get(k) ?? "").trim() || null;
  const input = { title: text("title") ?? "", url: text("url"), topics: formData.getAll("topics").map(String), publishedOn: text("published_on"), description: text("description") };
  try {
    const topics = await vocabulary(ctx.workspace.id);
    await withWorkspace(ctx.workspace.id, (tx) => addContentItem(tx, actorOf(ctx), input, topics));
  } catch (error) {
    if (error instanceof ContentError) return { message: error.message, values: { title: input.title, url: input.url ?? "", published_on: input.publishedOn ?? "", description: input.description ?? "", topics: input.topics } };
    throw error;
  }
  redirect(`${PAGE}?notice=content_added`);
}

export async function removeContentAction(id: string): Promise<void> {
  const ctx = await requireSettings();
  if (!UUID_RE.test(id)) redirect(PAGE);
  await withWorkspace(ctx.workspace.id, (tx) => removeContentItem(tx, actorOf(ctx), id));
  redirect(`${PAGE}?notice=content_removed`);
}

export interface StoredContentBatch {
  rows: ContentPreviewRow[];
  unknownColumns: string[];
}

export async function uploadContentImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireSettings();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { message: "Choose a CSV file to upload.", fieldErrors: { file: "Choose a CSV file to upload." } };
  if (file.size > MAX_IMPORT_BYTES) return { message: "The file is larger than 5 MB.", fieldErrors: { file: "The file is larger than 5 MB. Split it into smaller files." } };
  let preview: StoredContentBatch;
  try {
    preview = previewContent(await file.text(), await vocabulary(ctx.workspace.id));
  } catch (error) {
    if (error instanceof ContentError || error instanceof CsvError) return { message: "Check this field: file.", fieldErrors: { file: error.message } };
    throw error;
  }
  const batchId = await withWorkspace(ctx.workspace.id, async (tx) => {
    const [batch] = await tx.insert(importBatches).values({ workspaceId: ctx.workspace.id, kind: "content_library", filename: file.name.slice(0, 200), rows: preview, createdBy: ctx.user.id }).returning({ id: importBatches.id });
    return batch!.id;
  });
  redirect(`${PAGE}/import/${batchId}`);
}

export async function commitContentImportAction(batchId: string): Promise<void> {
  const ctx = await requireSettings();
  if (!UUID_RE.test(batchId)) redirect(PAGE);
  const topics = await vocabulary(ctx.workspace.id);
  const outcome = await withWorkspace(ctx.workspace.id, async (tx) => {
    const [batch] = await tx.select().from(importBatches).where(and(eq(importBatches.id, batchId), eq(importBatches.kind, "content_library"), eq(importBatches.status, "previewed"))).limit(1);
    if (!batch) return "gone" as const;
    const report = await commitContent(tx, actorOf(ctx), (batch.rows as StoredContentBatch).rows, topics);
    await tx.update(importBatches).set({ status: "committed", report, committedAt: new Date() }).where(eq(importBatches.id, batchId));
    await audit(tx, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, actorKind: "user", action: "import.committed", entityType: "import_batch", entityId: batchId, after: { kind: "content_library", created: report.created, rejected: report.rejected.length } });
    return "done" as const;
  });
  redirect(`${PAGE}/import/${batchId}?notice=${outcome === "gone" ? "import_already_done" : "import_committed"}`);
}

export async function discardContentImportAction(batchId: string): Promise<void> {
  const ctx = await requireSettings();
  if (!UUID_RE.test(batchId)) redirect(PAGE);
  await withWorkspace(ctx.workspace.id, (tx) => tx.update(importBatches).set({ status: "discarded" }).where(and(eq(importBatches.id, batchId), eq(importBatches.kind, "content_library"), eq(importBatches.status, "previewed"))));
  redirect(`${PAGE}?notice=import_discarded`);
}
