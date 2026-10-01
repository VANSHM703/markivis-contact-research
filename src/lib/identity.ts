/**
 * Sign-in identity resolution (BRD 5.2). Runs as dmi_system because it has to look across
 * workspaces before the user has one.
 */
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { withSystem, type Tx } from "@/db/client";
import { breakGlassGrants, users, workspaceMembers, workspaces } from "@/db/schema";
import type { WorkspaceRole } from "@/config/navigation";
import { audit } from "./audit";

/** Role given to someone who signs in through a workspace's domain allow-list without an invitation. */
export const DOMAIN_ALLOW_LIST_ROLE: WorkspaceRole = "account_lead";

export type SignInResult = { ok: true; userId: string } | { ok: false; reason: "not_allowed" };

export interface SignInInput {
  email: string;
  name?: string | null;
  amr?: string[] | null;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  return normaliseEmail(email).split("@")[1] ?? "";
}

export async function resolveSignIn(input: SignInInput): Promise<SignInResult> {
  const email = normaliseEmail(input.email);
  const domain = emailDomain(email);
  if (!domain) return { ok: false, reason: "not_allowed" };

  return withSystem("identity", async (tx) => {
    let [user] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
    const memberships = user
      ? await tx
          .select()
          .from(workspaceMembers)
          .where(and(eq(workspaceMembers.userId, user.id), inArray(workspaceMembers.status, ["active", "invited"])))
      : [];

    const domainWorkspaces = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(sql`${domain} = any(${workspaces.allowedEmailDomains})`);

    // A platform admin may sign in without a workspace: they reach data only through break-glass access.
    if (memberships.length === 0 && domainWorkspaces.length === 0 && !user?.isPlatformAdmin) return { ok: false, reason: "not_allowed" };

    if (!user) {
      [user] = await tx
        .insert(users)
        .values({ email, name: input.name?.trim() || email })
        .returning();
    }
    if (!user) throw new Error("Could not create user.");
    const userId = user.id;

    // Join every domain-allowed workspace the user is not already in.
    const memberOf = new Set(memberships.map((m) => m.workspaceId));
    for (const ws of domainWorkspaces) {
      if (memberOf.has(ws.id)) continue;
      await tx.insert(workspaceMembers).values({ workspaceId: ws.id, userId, role: DOMAIN_ALLOW_LIST_ROLE, status: "active" });
      await audit(tx, {
        workspaceId: ws.id,
        actorUserId: userId,
        actorKind: "system",
        action: "member.joined_by_domain",
        entityType: "user",
        entityId: userId,
        after: { role: DOMAIN_ALLOW_LIST_ROLE, domain },
      });
      memberOf.add(ws.id);
    }

    // Accept pending invitations.
    await tx
      .update(workspaceMembers)
      .set({ status: "active" })
      .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.status, "invited")));

    await tx.update(users).set({ lastSignInAt: new Date(), lastAmr: input.amr ?? null }).where(eq(users.id, userId));

    // A platform admin in no workspace signs in at platform level.
    for (const workspaceId of memberOf.size ? memberOf : [null]) {
      await audit(tx, {
        workspaceId,
        actorUserId: userId,
        actorKind: "user",
        action: "auth.sign_in",
        entityType: "user",
        entityId: userId,
        after: { amr: input.amr ?? null },
      });
    }
    return { ok: true, userId };
  });
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
  return withSystem("identity", async (tx) => {
    const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.email, normaliseEmail(email))).limit(1);
    return row?.id ?? null;
  });
}

export interface Membership {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: WorkspaceRole;
  /** Set for a platform admin's break-glass access, which is read-only (src/domain/break-glass.ts). */
  breakGlass?: { grantId: string; expiresAt: Date; reason: string };
}

function membershipsIn(tx: Tx, userId: string): Promise<Membership[]> {
  return tx
    .select({
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.status, "active")))
    .orderBy(workspaces.name);
}

async function grantsIn(tx: Tx, userId: string, now: Date): Promise<Membership[]> {
  const rows = await tx
    .select({ grantId: breakGlassGrants.id, workspaceId: workspaces.id, workspaceName: workspaces.name, workspaceSlug: workspaces.slug, expiresAt: breakGlassGrants.expiresAt, reason: breakGlassGrants.reason })
    .from(breakGlassGrants)
    .innerJoin(workspaces, eq(workspaces.id, breakGlassGrants.workspaceId))
    .innerJoin(users, and(eq(users.id, breakGlassGrants.userId), eq(users.isPlatformAdmin, true)))
    .where(and(eq(breakGlassGrants.userId, userId), isNull(breakGlassGrants.endedAt), gt(breakGlassGrants.expiresAt, now)))
    .orderBy(workspaces.name);
  return rows.map((g) => ({ workspaceId: g.workspaceId, workspaceName: g.workspaceName, workspaceSlug: g.workspaceSlug, role: "account_lead" as const, breakGlass: { grantId: g.grantId, expiresAt: g.expiresAt, reason: g.reason } }));
}

export async function listMemberships(userId: string): Promise<Membership[]> {
  return withSystem("identity", (tx) => membershipsIn(tx, userId));
}

/** Break-glass grants in force for a platform admin, as read-only memberships. Empty for anyone else. */
export async function listBreakGlassMemberships(userId: string, now = new Date()): Promise<Membership[]> {
  return withSystem("identity", (tx) => grantsIn(tx, userId, now));
}

export interface Access {
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean };
  memberships: Membership[];
  /** Break-glass grants in force, for a platform admin, as read-only memberships. */
  grants: Membership[];
}

/**
 * Everything the request context needs about a user, in one system-scoped read: a user who is in
 * a workspace only through break-glass access is not a member, so a workspace scope cannot see them.
 */
export async function loadAccess(userId: string, now = new Date()): Promise<Access | null> {
  return withSystem("identity", async (tx) => {
    const [user] = await tx.select({ id: users.id, name: users.name, email: users.email, isPlatformAdmin: users.isPlatformAdmin }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return null;
    return { user, memberships: await membershipsIn(tx, userId), grants: user.isPlatformAdmin ? await grantsIn(tx, userId, now) : [] };
  });
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [row] = await withSystem("identity", (tx) => tx.select({ admin: users.isPlatformAdmin }).from(users).where(eq(users.id, userId)).limit(1));
  return row?.admin === true;
}

/**
 * Users who can use the mock-mode sign-in bypass: every active member of any workspace, and
 * platform admins who belong to none (role null).
 */
export async function listMockSignInUsers(): Promise<{ email: string; name: string; role: WorkspaceRole | null; workspaceName: string | null }[]> {
  return withSystem("identity", async (tx) => {
    const members = await tx
      .selectDistinctOn([users.email], {
        email: users.email,
        name: users.name,
        role: workspaceMembers.role,
        workspaceName: workspaces.name,
      })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.status, "active"))
      .orderBy(users.email, workspaces.name);
    const admins = await tx
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(and(eq(users.isPlatformAdmin, true), sql`not exists (select 1 from dmi.workspace_members m where m.user_id = ${users.id} and m.status = 'active')`))
      .orderBy(users.email);
    return [...members, ...admins.map((a) => ({ ...a, role: null, workspaceName: null }))];
  });
}
