"use server";

/** "Create action" on a priority 3 signal (BRD 12.1: P3 signals create actions only on request). */
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { withWorkspace } from "@/db/client";
import { signals } from "@/db/schema";
import { actionsToDraft, createActionForSignal, draftForAction } from "@/domain/actions";
import { getRequestContext } from "@/lib/context";
import { can } from "@/lib/permissions";

export async function createActionFromSignalAction(signalId: string): Promise<void> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!can(ctx.role, "records.edit")) redirect("/?notice=not_allowed");
  const created = await withWorkspace(ctx.workspace.id, async (tx) => {
    const [signal] = await tx.select().from(signals).where(eq(signals.id, signalId)).limit(1);
    if (!signal || signal.status !== "confirmed") return null;
    return createActionForSignal(tx, signal, new Date(), { force: true });
  });
  for (const id of actionsToDraft(created)) await draftForAction(ctx.workspace.id, id).catch(() => undefined);
  redirect(`/signals?notice=${created ? "action_created" : "not_allowed"}`);
}
