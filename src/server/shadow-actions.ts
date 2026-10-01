"use server";

/** The shadow run (BRD 24.1): a platform admin starts it and takes the workspace live. */
import { redirect } from "next/navigation";
import { withWorkspace } from "@/db/client";
import { draftForAction } from "@/domain/actions";
import { promoteShadow, startShadowRun } from "@/domain/shadow";
import { getRequestContext } from "@/lib/context";

async function requirePlatformAdmin() {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!ctx.user.isPlatformAdmin) redirect("/?notice=not_allowed");
  return ctx;
}

export async function startShadowRunAction(): Promise<void> {
  const ctx = await requirePlatformAdmin();
  await withWorkspace(ctx.workspace.id, (tx) => startShadowRun(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id }));
  redirect("/queue?tab=shadow&notice=shadow_started");
}

export async function promoteShadowAction(): Promise<void> {
  const ctx = await requirePlatformAdmin();
  const result = await withWorkspace(ctx.workspace.id, (tx) => promoteShadow(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id }));
  for (const id of result.toDraft) await draftForAction(ctx.workspace.id, id).catch(() => undefined);
  redirect("/queue?notice=shadow_promoted");
}
