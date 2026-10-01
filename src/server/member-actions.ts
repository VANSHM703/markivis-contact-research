"use server";

/** Members and roles (BRD 5.3): invite, change role, remove. Partners and data stewards. */
import { redirect } from "next/navigation";
import { z } from "zod";
import { withWorkspace } from "@/db/client";
import { changeMemberRole, inviteMember, MemberError, removeMember, ROLES } from "@/domain/members";
import { getRequestContext } from "@/lib/context";
import { can } from "@/lib/permissions";

const PAGE = "/settings/members";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireManager() {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!can(ctx.role, "members.manage") || ctx.breakGlass) redirect("/?notice=not_allowed");
  return ctx;
}

function noticeFor(error: MemberError): string {
  if (/at least one partner/.test(error.message)) return "member_last_partner";
  if (/own (role|membership)|remove yourself/.test(error.message)) return "member_self";
  return "member_invalid";
}

const roleSchema = z.enum(ROLES as [string, ...string[]]);

export async function inviteMemberAction(formData: FormData): Promise<void> {
  const ctx = await requireManager();
  const role = roleSchema.safeParse(formData.get("role"));
  if (!role.success) redirect(`${PAGE}?notice=member_invalid`);
  let outcome: string;
  try {
    outcome = await inviteMember({ workspaceId: ctx.workspace.id, userId: ctx.user.id }, String(formData.get("email") ?? ""), role.data as (typeof ROLES)[number], String(formData.get("name") ?? "") || null);
  } catch (error) {
    if (error instanceof MemberError) redirect(`${PAGE}?notice=${noticeFor(error)}`);
    throw error;
  }
  redirect(`${PAGE}?notice=${outcome === "invited" ? "member_invited" : outcome === "reinvited" ? "member_reinvited" : "member_exists"}`);
}

export async function changeRoleAction(memberId: string, formData: FormData): Promise<void> {
  const ctx = await requireManager();
  const role = roleSchema.safeParse(formData.get("role"));
  if (!UUID_RE.test(memberId) || !role.success) redirect(`${PAGE}?notice=member_invalid`);
  try {
    await withWorkspace(ctx.workspace.id, (tx) => changeMemberRole(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, memberId, role.data as (typeof ROLES)[number]));
  } catch (error) {
    if (error instanceof MemberError) redirect(`${PAGE}?notice=${noticeFor(error)}`);
    throw error;
  }
  redirect(`${PAGE}?notice=role_changed`);
}

export async function removeMemberAction(memberId: string): Promise<void> {
  const ctx = await requireManager();
  if (!UUID_RE.test(memberId)) redirect(PAGE);
  try {
    await withWorkspace(ctx.workspace.id, (tx) => removeMember(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, memberId));
  } catch (error) {
    if (error instanceof MemberError) redirect(`${PAGE}?notice=${noticeFor(error)}`);
    throw error;
  }
  redirect(`${PAGE}?notice=member_removed`);
}
