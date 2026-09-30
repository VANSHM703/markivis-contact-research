"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { APP_BASE_PATH } from "@/config/product";
import { withWorkspace } from "@/db/client";
import { audit } from "@/lib/audit";
import { isMockSignInEnabled, signIn, signOut } from "@/lib/auth";
import { getRequestContext, WORKSPACE_COOKIE } from "@/lib/context";

const HOME = `${APP_BASE_PATH}/`;

/** Mock mode only: continue as a seeded user (BRD 21). */
export async function mockSignInAction(formData: FormData): Promise<void> {
  if (!isMockSignInEnabled()) redirect("/sign-in?error=AccessDenied");
  try {
    await signIn("mock", { email: String(formData.get("email") ?? ""), redirectTo: HOME });
  } catch (error) {
    if (error instanceof AuthError) redirect("/sign-in?error=AccessDenied");
    throw error;
  }
}

export async function providerSignInAction(formData: FormData): Promise<void> {
  const provider = String(formData.get("provider") ?? "");
  if (provider !== "microsoft-entra-id" && provider !== "google") redirect("/sign-in");
  await signIn(provider, { redirectTo: HOME });
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: `${APP_BASE_PATH}/sign-in` });
}

/** Switches the current workspace for a user who belongs to several (BRD 5.1). */
export async function switchWorkspaceAction(formData: FormData): Promise<void> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  const target = String(formData.get("workspaceId") ?? "");
  const membership = ctx.memberships.find((m) => m.workspaceId === target);
  if (!membership) redirect("/");
  (await cookies()).set(WORKSPACE_COOKIE, membership.workspaceId, {
    path: APP_BASE_PATH,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.APP_URL?.startsWith("https://") ?? false,
    maxAge: 60 * 60 * 24 * 90,
  });
  await withWorkspace(membership.workspaceId, (tx) =>
    audit(tx, { workspaceId: membership.workspaceId, actorUserId: ctx.user.id, actorKind: "user", action: "workspace.switched_to" }),
  );
  redirect("/");
}
