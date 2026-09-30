/**
 * The request context: who is signed in, which workspace they are working in, and their role.
 * Every page and API route gets its workspace scope from here.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { users, workspaces } from "@/db/schema";
import type { WorkspaceRole } from "@/config/navigation";
import { auth } from "./auth";
import { listMemberships, type Membership } from "./identity";
import { can, type Capability } from "./permissions";

/** Remembers the chosen workspace for users with more than one. Path-scoped like every cookie. */
export const WORKSPACE_COOKIE = "dmi.workspace";

export interface RequestContext {
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean };
  workspace: { id: string; name: string; slug: string; timezone: string; packs: Record<string, boolean>; flags: Record<string, boolean>; settings: Record<string, unknown> };
  role: WorkspaceRole;
  memberships: Membership[];
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  partner: "Partner",
  outreach_owner: "Outreach owner",
  validator: "Validator",
  account_lead: "Account lead",
  data_steward: "Data steward",
};

/** Builds the context for a user, preferring the given workspace when they belong to it. */
export async function buildContext(userId: string, preferredWorkspaceId?: string | null): Promise<RequestContext | null> {
  const memberships = await listMemberships(userId);
  const membership = memberships.find((m) => m.workspaceId === preferredWorkspaceId) ?? memberships[0];
  if (!membership) return null;

  return withWorkspace(membership.workspaceId, async (tx) => {
    const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, membership.workspaceId)).limit(1);
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!ws || !user) return null;
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

export function contextCan(ctx: RequestContext, capability: Capability): boolean {
  return can(ctx.role, capability);
}
