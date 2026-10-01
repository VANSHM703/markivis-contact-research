"use server";

/** Platform admin actions (BRD 5.3): break-glass access in and out of a workspace. */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { APP_BASE_PATH } from "@/config/product";
import { BreakGlassError, endBreakGlass, startBreakGlass } from "@/domain/break-glass";
import { getSignedInUser, WORKSPACE_COOKIE } from "@/lib/context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requirePlatformAdmin() {
  const user = await getSignedInUser();
  if (!user) redirect("/sign-in");
  if (!user.isPlatformAdmin) redirect("/?notice=not_allowed");
  return user;
}

async function chooseWorkspace(workspaceId: string | null) {
  const jar = await cookies();
  if (!workspaceId) {
    jar.delete({ name: WORKSPACE_COOKIE, path: APP_BASE_PATH });
    return;
  }
  jar.set(WORKSPACE_COOKIE, workspaceId, { path: APP_BASE_PATH, httpOnly: true, sameSite: "lax", secure: process.env.APP_URL?.startsWith("https://") ?? false, maxAge: 60 * 60 * 12 });
}

export async function startBreakGlassAction(formData: FormData): Promise<void> {
  const user = await requirePlatformAdmin();
  const workspaceId = String(formData.get("workspace_id") ?? "");
  if (!UUID_RE.test(workspaceId)) redirect("/platform");
  try {
    await startBreakGlass(user.id, workspaceId, String(formData.get("reason") ?? ""), Number(formData.get("minutes") ?? 0));
  } catch (error) {
    if (error instanceof BreakGlassError) redirect(`/platform?notice=${/member/.test(error.message) ? "break_glass_member" : "break_glass_invalid"}`);
    throw error;
  }
  await chooseWorkspace(workspaceId);
  redirect("/");
}

export async function endBreakGlassAction(formData: FormData): Promise<void> {
  const user = await requirePlatformAdmin();
  const grantId = String(formData.get("grant_id") ?? "");
  if (!UUID_RE.test(grantId)) redirect("/platform");
  try {
    await endBreakGlass(user.id, grantId);
  } catch (error) {
    if (!(error instanceof BreakGlassError)) throw error;
  }
  await chooseWorkspace(null);
  redirect("/platform?notice=break_glass_ended");
}

/** Opens a workspace the admin is a member of, or already has break-glass access to. */
export async function openWorkspaceAction(formData: FormData): Promise<void> {
  await requirePlatformAdmin();
  const workspaceId = String(formData.get("workspace_id") ?? "");
  if (!UUID_RE.test(workspaceId)) redirect("/platform");
  await chooseWorkspace(workspaceId);
  redirect("/");
}
