"use server";

/** Resolving conflicts and possible duplicates from the queue (BRD 10.4). */
import { redirect } from "next/navigation";
import { withWorkspace } from "@/db/client";
import { QueueItemError, resolveConflict, resolveDuplicate } from "@/domain/queue-items";
import { getRequestContext } from "@/lib/context";
import { can } from "@/lib/permissions";

async function requireValidator() {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!can(ctx.role, "queue.work")) redirect("/?notice=not_allowed");
  return ctx;
}

export async function resolveConflictAction(itemId: string, formData: FormData): Promise<void> {
  const ctx = await requireValidator();
  const chosen = String(formData.get("field_source_id") ?? "");
  try {
    await withWorkspace(ctx.workspace.id, (tx) => resolveConflict(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, itemId, chosen));
  } catch (error) {
    if (error instanceof QueueItemError) redirect("/queue?tab=conflicts&notice=item_gone");
    throw error;
  }
  redirect("/queue?tab=conflicts&notice=conflict_resolved");
}

export async function resolveDuplicateAction(itemId: string, formData: FormData): Promise<void> {
  const ctx = await requireValidator();
  if (!can(ctx.role, "persons.merge")) redirect("/queue?tab=conflicts&notice=not_allowed");
  const decision = String(formData.get("decision") ?? "");
  try {
    await withWorkspace(ctx.workspace.id, (tx) =>
      resolveDuplicate(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, itemId, decision === "keep_separate" ? { merge: false } : { merge: true, survivorId: decision }),
    );
  } catch (error) {
    if (error instanceof QueueItemError) redirect("/queue?tab=conflicts&notice=item_gone");
    throw error;
  }
  redirect(`/queue?tab=conflicts&notice=${decision === "keep_separate" ? "kept_separate" : "duplicate_merged"}`);
}
