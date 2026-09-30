"use server";

/** Mailbox and calendar connections, exclusions, privacy marks and "Log interaction" (BRD 11, 16.4). */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/forms/FormState";
import { withWorkspace } from "@/db/client";
import { captureExclusions, oauthConnections } from "@/db/schema";
import { runCalendarCapture, runMailCapture } from "@/capture/capture";
import { revokeConnection, saveConnection } from "@/capture/connections";
import { logInteraction, logSchema } from "@/capture/manual";
import { setPersonPrivate, setThreadPrivate } from "@/capture/privacy";
import type { CaptureProviderName } from "@/capture/types";
import { getDataMode } from "@/config/env";
import { enqueue } from "@/jobs/enqueue";
import { audit } from "@/lib/audit";
import { getRequestContext, type RequestContext } from "@/lib/context";
import { can, type Capability } from "@/lib/permissions";
import { localTime } from "@/lib/working-days";
import { UUID_RE } from "./guards";

const PAGE = "/settings/connections";
const PROVIDERS: CaptureProviderName[] = ["microsoft", "google"];

async function require(capability: Capability): Promise<RequestContext> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!can(ctx.role, capability)) redirect("/?notice=not_allowed");
  return ctx;
}
const actorOf = (ctx: RequestContext) => ({ workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role });
const provider = (p: string): CaptureProviderName => (PROVIDERS.includes(p as CaptureProviderName) ? (p as CaptureProviderName) : redirect(PAGE));

/** Mock mode: connect the user's demo mailbox, which reads fixtures (BRD 17.4). */
export async function connectMockAction(p: string): Promise<void> {
  const ctx = await require("mailbox.connect");
  const name = provider(p);
  if (getDataMode() !== "mock") redirect(`${PAGE}?notice=connect_failed`);
  const connectionId = await withWorkspace(ctx.workspace.id, (tx) => saveConnection(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id, provider: name, accountEmail: ctx.user.email, tokens: null, mock: true }));
  await runMailCapture(ctx.workspace.id, { connectionId });
  await runCalendarCapture(ctx.workspace.id, { connectionId });
  redirect(`${PAGE}?notice=connected`);
}

export async function disconnectAction(p: string): Promise<void> {
  const ctx = await require("mailbox.connect");
  await withWorkspace(ctx.workspace.id, (tx) => revokeConnection(tx, actorOf(ctx), provider(p)));
  redirect(`${PAGE}?notice=disconnected`);
}

/** Sync now: inline in mock mode (instant), on the worker in live mode. */
export async function syncNowAction(p: string): Promise<void> {
  const ctx = await require("mailbox.connect");
  const name = provider(p);
  const [c] = await withWorkspace(ctx.workspace.id, (tx) => tx.select().from(oauthConnections).where(and(eq(oauthConnections.userId, ctx.user.id), eq(oauthConnections.provider, name), eq(oauthConnections.status, "active"))).limit(1));
  if (!c) redirect(`${PAGE}?notice=connect_failed`);
  if (getDataMode() === "mock") {
    await runMailCapture(ctx.workspace.id, { connectionId: c.id });
    await runCalendarCapture(ctx.workspace.id, { connectionId: c.id });
    redirect(`${PAGE}?notice=synced`);
  }
  try {
    await enqueue("capture.mail", { workspaceId: ctx.workspace.id, connectionId: c.id });
    await enqueue("capture.calendar", { workspaceId: ctx.workspace.id, connectionId: c.id });
  } catch {
    redirect(`${PAGE}?notice=queue_unavailable`);
  }
  redirect(`${PAGE}?notice=run_queued`);
}

/** A datetime-local value ("2026-09-30T14:30"), read as the workspace's local time. */
function fromLocal(value: string | undefined, timeZone: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? "");
  return m ? localTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), timeZone) : undefined;
}

const PATTERN = /^(@?[a-z0-9.-]+\.[a-z]{2,}|[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,})$/;

export async function addExclusionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await require("mailbox.connect");
  const pattern = String(formData.get("pattern") ?? "").trim().toLowerCase();
  if (!PATTERN.test(pattern)) return { message: "Check this field: address or domain.", fieldErrors: { pattern: "Enter an email address (jane@example.com) or a domain (example.com)." }, values: { pattern } };
  await withWorkspace(ctx.workspace.id, async (tx) => {
    await tx.insert(captureExclusions).values({ workspaceId: ctx.workspace.id, userId: ctx.user.id, pattern }).onConflictDoNothing();
    // The audit entry records that an exclusion was added, not which address.
    await audit(tx, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, actorKind: "user", action: "capture.exclusion_added", entityType: "user", entityId: ctx.user.id });
  });
  redirect(`${PAGE}?notice=exclusion_added`);
}

export async function removeExclusionAction(id: string): Promise<void> {
  const ctx = await require("mailbox.connect");
  if (!UUID_RE.test(id)) redirect(PAGE);
  await withWorkspace(ctx.workspace.id, (tx) => tx.delete(captureExclusions).where(and(eq(captureExclusions.id, id), eq(captureExclusions.userId, ctx.user.id))));
  redirect(`${PAGE}?notice=exclusion_removed`);
}

// ---------------------------------------------------------------------------------------------
// Privacy (partner only) and manual logging
// ---------------------------------------------------------------------------------------------

export async function setThreadPrivateAction(personId: string, threadKey: string, on: boolean): Promise<void> {
  const ctx = await require("privacy.mark_private");
  if (!UUID_RE.test(personId) || !threadKey || threadKey.length > 500) redirect("/people");
  await withWorkspace(ctx.workspace.id, (tx) => setThreadPrivate(tx, actorOf(ctx), threadKey, on));
  redirect(`/people/${personId}?tab=interactions&notice=${on ? "thread_private" : "thread_public"}`);
}

export async function setPersonPrivateAction(personId: string, on: boolean): Promise<void> {
  const ctx = await require("privacy.mark_private");
  if (!UUID_RE.test(personId)) redirect("/people");
  await withWorkspace(ctx.workspace.id, (tx) => setPersonPrivate(tx, actorOf(ctx), personId, on));
  redirect(`/people/${personId}?tab=interactions&notice=${on ? "person_private" : "person_public"}`);
}

export async function logInteractionAction(personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await require("records.edit");
  if (!UUID_RE.test(personId)) redirect("/people");
  const values = Object.fromEntries(Array.from(formData.entries()).map(([k, v]) => [k, String(v)]));
  const parsed = logSchema.safeParse({
    channel: values.channel,
    occurredAt: fromLocal(values.occurred_at, ctx.workspace.timezone),
    direction: values.direction,
    summary: values.summary,
    subject: values.subject,
    isPrivate: values.is_private === "on",
  });
  if (!parsed.success) {
    const map: Record<string, string> = { occurredAt: "occurred_at", isPrivate: "is_private" };
    const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [map[String(i.path[0])] ?? String(i.path[0]), i.message]));
    return { message: `Check ${Object.keys(fieldErrors).length === 1 ? "this field" : "these fields"}: ${Object.keys(fieldErrors).join(", ").replace(/_/g, " ")}.`, fieldErrors, values };
  }
  await withWorkspace(ctx.workspace.id, (tx) => logInteraction(tx, actorOf(ctx), personId, parsed.data));
  redirect(`/people/${personId}?tab=interactions&notice=interaction_logged`);
}
