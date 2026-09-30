/**
 * Sign-in identity resolution (BRD 5.2). Runs as dmi_system because it has to look across
 * workspaces before the user has one.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { users, workspaceMembers, workspaces } from "@/db/schema";
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

    if (memberships.length === 0 && domainWorkspaces.length === 0) return { ok: false, reason: "not_allowed" };

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

    for (const workspaceId of memberOf) {
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
}

export async function listMemberships(userId: string): Promise<Membership[]> {
  return withSystem("identity", async (tx) =>
    tx
      .select({
        workspaceId: workspaces.id,
        workspaceName: workspaces.name,
        workspaceSlug: workspaces.slug,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.status, "active")))
      .orderBy(workspaces.name),
  );
}

/** Users who can use the mock-mode sign-in bypass: every active member of any workspace. */
export async function listMockSignInUsers() {
  return withSystem("identity", async (tx) =>
    tx
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
      .orderBy(users.email, workspaces.name),
  );
}
