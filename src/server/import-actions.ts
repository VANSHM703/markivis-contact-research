"use server";

/** CSV import: upload and preview, then commit or discard (BRD 16.4). */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/forms/FormState";
import { withWorkspace } from "@/db/client";
import { importBatches } from "@/db/schema";
import { CsvError } from "@/domain/imports/csv";
import { commitTargetList, ImportFileError, MAX_IMPORT_BYTES, previewTargetList, readTargetListFile, type PreviewRow } from "@/domain/imports/target-list";
import { audit } from "@/lib/audit";
import { getRequestContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { formObject, invalidAll, parseForm, sourceSchema } from "./forms";

async function requireEditor() {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!can(ctx.role, "records.edit")) redirect("/?notice=not_allowed");
  return ctx;
}

export async function uploadTargetListAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireEditor();
  const raw = formObject(formData);
  const source = parseForm(sourceSchema, raw);
  const file = formData.get("file");
  const fileProblem = !(file instanceof File) || file.size === 0 ? "Choose a CSV file to upload." : file.size > MAX_IMPORT_BYTES ? "The file is larger than 5 MB. Split it into smaller files." : null;
  const problems = invalidAll([source], raw, fileProblem ? { file: fileProblem } : {});
  if (problems || !source.success || !(file instanceof File)) return problems!;

  let parsed;
  try {
    parsed = readTargetListFile(await file.text());
  } catch (error) {
    if (error instanceof ImportFileError || error instanceof CsvError) return { message: "Check this field: file.", fieldErrors: { file: error.message }, values: strings(raw) };
    throw error;
  }

  const batchId = await withWorkspace(ctx.workspace.id, async (tx) => {
    const preview = await previewTargetList(tx, ctx.workspace.id, parsed.rows, parsed.unknownColumns);
    const [batch] = await tx
      .insert(importBatches)
      .values({
        workspaceId: ctx.workspace.id,
        kind: "target_list",
        filename: file.name.slice(0, 200),
        rows: { rows: preview.rows, summary: preview.summary, source: { sourceType: source.data.source_type, note: source.data.source_note, sourceUrl: source.data.source_url } },
        createdBy: ctx.user.id,
      })
      .returning({ id: importBatches.id });
    return batch!.id;
  });
  redirect(`/people/import/${batchId}`);
}

export interface StoredBatch {
  rows: PreviewRow[];
  summary: Awaited<ReturnType<typeof previewTargetList>>["summary"];
  source: { sourceType: "manual" | "leadership_page" | "press_wire" | "sec_8k" | "event_site" | "google_alert" | "apollo"; note: string; sourceUrl: string | null };
}

export async function commitImportAction(batchId: string): Promise<void> {
  const ctx = await requireEditor();
  const outcome = await withWorkspace(ctx.workspace.id, async (tx) => {
    const [batch] = await tx.select().from(importBatches).where(and(eq(importBatches.id, batchId), eq(importBatches.status, "previewed"))).limit(1);
    if (!batch) return "gone" as const;
    const stored = batch.rows as StoredBatch;
    const report = await commitTargetList(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, batchId, stored.rows, stored.source);
    await tx.update(importBatches).set({ status: "committed", report, committedAt: new Date() }).where(eq(importBatches.id, batchId));
    await audit(tx, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, actorKind: "user", action: "import.committed", entityType: "import_batch", entityId: batchId, after: report });
    return "done" as const;
  });
  redirect(`/people/import/${batchId}${outcome === "gone" ? "?notice=import_already_done" : "?notice=import_committed"}`);
}

export async function discardImportAction(batchId: string): Promise<void> {
  const ctx = await requireEditor();
  await withWorkspace(ctx.workspace.id, (tx) =>
    tx.update(importBatches).set({ status: "discarded" }).where(and(eq(importBatches.id, batchId), eq(importBatches.status, "previewed"))),
  );
  redirect("/people/import?notice=import_discarded");
}

function strings(raw: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? "")]));
}
