/**
 * The request context: who is signed in, which workspace they are working in, and their role.
 * Every page and API route gets its workspace scope from here.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { workspaces } from "@/db/schema";
import type { WorkspaceRole } from "@/config/navigation";
import { auth } from "./auth";
import { isPlatformAdmin, loadAccess, type Membership } from "./identity";
import { can, type Capability } from "./permissions";

/** Remembers the chosen workspace for users with more than one. Path-scoped like every cookie. */
export const WORKSPACE_COOKIE = "dmi.workspace";

export interface RequestContext {
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean };
  workspace: { id: string; name: string; slug: string; timezone: string; packs: Record<string, boolean>; flags: Record<string, boolean>; settings: Record<string, unknown> };
  role: WorkspaceRole;
  memberships: Membership[];
  /** Set while a platform admin works through break-glass access; the role is then read-only. */
  breakGlass: Membership["breakGlass"] | null;
}

export { ROLE_LABELS } from "./format/labels";

/** Builds the context for a user, preferring the given workspace when they belong to it. */
export async function buildContext(userId: string, preferredWorkspaceId?: string | null): Promise<RequestContext | null> {
  const access = await loadAccess(userId);
  if (!access) return null;
  const direct = access.memberships;
  const memberships = [...direct, ...access.grants.filter((g) => !direct.some((m) => m.workspaceId === g.workspaceId))];
  // Break-glass access is used only when chosen; a member's own workspaces come first.
  const membership = memberships.find((m) => m.workspaceId === preferredWorkspaceId) ?? direct[0];
  if (!membership) return null;

  return withWorkspace(membership.workspaceId, async (tx) => {
    const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, membership.workspaceId)).limit(1);
    if (!ws) return null;
    const user = access.user;
    return {
      user: { id: user.id, name: user.name, email: user.email, isPlatformAdmin: user.isPlatformAdmin },
      workspace: {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        timezone: ws.timezone,
        packs: ws.packs as Record<string, boolean>,
        flags: ws.flags as Record<string, boolean>,
        settings: ws.settings as Record<string, unknown>,
      },
      role: membership.role,
      memberships,
      breakGlass: membership.breakGlass ?? null,
    };
  });
}

/** The context for the current request, or null when nobody is signed in. Cached per request. */
export const getRequestContext = cache(async (): Promise<RequestContext | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  return buildContext(userId, preferred);
});

/** The signed-in user's id, with or without a workspace, for the platform pages. Cached per request. */
export const getSignedInUser = cache(async (): Promise<{ id: string; isPlatformAdmin: boolean } | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  return { id: userId, isPlatformAdmin: await isPlatformAdmin(userId) };
});

export function contextCan(ctx: RequestContext, capability: Capability): boolean {
  return can(ctx.role, capability);
}
