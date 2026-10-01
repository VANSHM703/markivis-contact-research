"use server";

/** Settings: service levels, digest time, send limit and the style guide (BRD 12.8, 20.3). */
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withWorkspace } from "@/db/client";
import { workspaces } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getRequestContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { SIGNAL_RULES } from "@/pipeline/rules";

const PAGE = "/settings/workflow";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

async function requireSettings() {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!can(ctx.role, "settings.change")) redirect("/?notice=not_allowed");
  return ctx;
}

const workflowSchema = z.object({
  p1: z.coerce.number().int().min(1).max(20),
  p2: z.coerce.number().int().min(1).max(30),
  lead: z.coerce.number().int().min(0).max(20),
  digest_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  max_per_day: z.coerce.number().int().min(1).max(200),
  working_days: z.array(z.enum(DAYS)).min(1),
});

export async function saveWorkflowAction(formData: FormData): Promise<void> {
  const ctx = await requireSettings();
  const parsed = workflowSchema.safeParse({
    p1: formData.get("p1"),
    p2: formData.get("p2"),
    lead: formData.get("lead"),
    digest_time: formData.get("digest_time"),
    max_per_day: formData.get("max_per_day"),
    working_days: formData.getAll("working_days").map(String),
  });
  if (!parsed.success) redirect(`${PAGE}?notice=workflow_invalid`);
  const v = parsed.data;
  await withWorkspace(ctx.workspace.id, async (tx) => {
    const [ws] = await tx.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, ctx.workspace.id)).limit(1);
    const before = ws!.settings as Record<string, unknown>;
    const next = {
      ...before,
      sla: { ...(before.sla as object), p1_working_days: v.p1, p2_working_days: v.p2, announced_lead_working_days: v.lead },
      digest_time: v.digest_time,
      working_days: DAYS.filter((d) => v.working_days.includes(d)),
      send: { ...(before.send as object), max_per_day: v.max_per_day },
    };
    await tx.update(workspaces).set({ settings: next }).where(eq(workspaces.id, ctx.workspace.id));
    await audit(tx, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, actorKind: "user", action: "settings.workflow_changed", entityType: "workspace", entityId: ctx.workspace.id, before: { sla: before.sla, digest_time: before.digest_time, working_days: before.working_days, send: before.send }, after: { sla: next.sla, digest_time: next.digest_time, working_days: next.working_days, send: next.send } });
  });
  redirect(`${PAGE}?notice=workflow_saved`);
}

export async function saveStyleGuideAction(formData: FormData): Promise<void> {
  const ctx = await requireSettings();
  const text = String(formData.get("style_guide") ?? "").replace(/\r\n/g, "\n").trim();
  if (text.length < 40 || text.length > 4000) redirect(`${PAGE}?notice=style_guide_invalid`);
  await withWorkspace(ctx.workspace.id, async (tx) => {
    const [ws] = await tx.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, ctx.workspace.id)).limit(1);
    const before = ws!.settings as Record<string, unknown>;
    await tx.update(workspaces).set({ settings: { ...before, style_guide: text } }).where(eq(workspaces.id, ctx.workspace.id));
    await audit(tx, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, actorKind: "user", action: "settings.style_guide_changed", entityType: "workspace", entityId: ctx.workspace.id, before: { style_guide: before.style_guide }, after: { style_guide: text } });
  });
  redirect(`${PAGE}?notice=style_guide_saved`);
}

const PRIORITY_VALUES = new Set(["1", "2", "3"]);

/** Signal priorities (BRD 16 Settings): a workspace priority per type, or the default. */
export async function savePrioritiesAction(formData: FormData): Promise<void> {
  const ctx = await requireSettings();
  const next: Record<string, 1 | 2 | 3> = {};
  for (const type of Object.keys(SIGNAL_RULES)) {
    const value = String(formData.get(`priority_${type}`) ?? "default");
    if (PRIORITY_VALUES.has(value) && Number(value) !== SIGNAL_RULES[type as keyof typeof SIGNAL_RULES].priority) next[type] = Number(value) as 1 | 2 | 3;
  }
  await withWorkspace(ctx.workspace.id, async (tx) => {
    const [ws] = await tx.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, ctx.workspace.id)).limit(1);
    const before = ws!.settings as Record<string, unknown>;
    await tx.update(workspaces).set({ settings: { ...before, signal_priorities: next } }).where(eq(workspaces.id, ctx.workspace.id));
    await audit(tx, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, actorKind: "user", action: "settings.priorities_changed", entityType: "workspace", entityId: ctx.workspace.id, before: { signal_priorities: before.signal_priorities ?? {} }, after: { signal_priorities: next } });
  });
  redirect("/settings/priorities?notice=priorities_saved");
}
