"use server";

/** Settings, CRM: the HubSpot private app token and Sync now (BRD 15, 20.2). */
import { redirect } from "next/navigation";
import { withWorkspace } from "@/db/client";
import { setWorkspaceSecret } from "@/domain/secrets";
import { runCrmSync } from "@/crm/sync";
import { getDataMode } from "@/config/env";
import { enqueue } from "@/jobs/enqueue";
import { EncryptionConfigError } from "@/lib/crypto";
import { getRequestContext } from "@/lib/context";
import { can } from "@/lib/permissions";

const PAGE = "/settings/crm";

async function need() {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!can(ctx.role, "settings.change")) redirect("/?notice=not_allowed");
  return ctx;
}

export async function saveHubSpotTokenAction(formData: FormData): Promise<void> {
  const ctx = await need();
  const token = String(formData.get("token") ?? "").trim();
  if (token.length < 20 || /\s/.test(token)) redirect(`${PAGE}?notice=crm_failed&why=token`);
  try {
    await withWorkspace(ctx.workspace.id, (tx) => setWorkspaceSecret(tx, ctx.workspace.id, "hubspot_private_app_token", token, ctx.user.id));
  } catch (error) {
    if (error instanceof EncryptionConfigError) redirect(`${PAGE}?notice=crm_failed&why=encryption`);
    throw error;
  }
  redirect(`${PAGE}?notice=crm_saved`);
}

export async function syncHubSpotAction(): Promise<void> {
  const ctx = await need();
  if (ctx.workspace.flags["crm.hubspot"] !== true) redirect(`${PAGE}?notice=crm_off`);
  if (getDataMode() === "mock") {
    const result = await runCrmSync(ctx.workspace.id);
    redirect(`${PAGE}?notice=${"skipped" in result ? "crm_failed" : "crm_synced"}`);
  }
  try {
    await enqueue("crm.sync", { workspaceId: ctx.workspace.id });
  } catch {
    redirect(`${PAGE}?notice=queue_unavailable`);
  }
  redirect(`${PAGE}?notice=run_queued`);
}
