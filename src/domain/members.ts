/**
 * Members and roles (BRD 5.3, 16 Settings): invite, change role, remove. Every change is written to
 * the audit log. A workspace always keeps at least one active partner, and nobody changes or
 * removes their own membership, so an administrator cannot lock the workspace out by mistake.
 *
 * Inviting creates the user row when the address is new; that one step runs as dmi_system with
 * the reason "identity", because a user who is not yet a member is outside the workspace scope.
 */
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { withSystem, withWorkspace, type Tx } from "@/db/client";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import type { WorkspaceRole } from "@/config/navigation";
import { audit } from "@/lib/audit";
import { ROLE_LABELS } from "@/lib/format/labels";
import { normaliseEmail } from "@/lib/normalise";
import { appLink, queueNotification } from "@/mail/notify";

export const ROLES: WorkspaceRole[] = ["partner", "outreach_owner", "validator", "account_lead", "data_steward"];

export class MemberError extends Error {}

export interface MemberRow {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  status: "invited" | "active" | "removed";
  lastSignInAt: Date | null;
  invitedByName: string | null;
}

export async function listMembers(tx: Tx): Promise<MemberRow[]> {
  const inviter = sql<string | null>`(select u2.name from dmi.users u2 where u2.id = ${workspaceMembers.invitedBy})`;
  return tx
    .select({ memberId: workspaceMembers.id, userId: users.id, name: users.name, email: users.email, role: workspaceMembers.role, status: workspaceMembers.status, lastSignInAt: users.lastSignInAt, invitedByName: inviter })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .orderBy(sql`${workspaceMembers.status} = 'removed'`, asc(users.name));
}

interface Actor {
  workspaceId: string;
  userId: string;
}

async function otherActivePartners(tx: Tx, memberId: string): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(workspaceMembers).where(and(eq(workspaceMembers.role, "partner"), eq(workspaceMembers.status, "active"), ne(workspaceMembers.id, memberId)));
  return row?.n ?? 0;
}

async function loadMember(tx: Tx, memberId: string) {
  const [m] = await tx.select().from(workspaceMembers).where(eq(workspaceMembers.id, memberId)).limit(1);
  if (!m) throw new MemberError("Member not found.");
  return m;
}

/** Invites an address with a role; they join on their first sign-in. Emails them a link. */
export async function inviteMember(actor: Actor, emailInput: string, role: WorkspaceRole, name?: string | null): Promise<"invited" | "reinvited" | "already"> {
  const email = normaliseEmail(emailInput);
  if (!email) throw new MemberError("Enter a valid email address.");
  if (!ROLES.includes(role)) throw new MemberError("Choose a role.");
  const userId = await withSystem("identity", async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) return existing.id;
    const [created] = await tx.insert(users).values({ email, name: name?.trim() || email }).returning({ id: users.id });
    return created!.id;
  });
  return withWorkspace(actor.workspaceId, async (tx) => {
    const [current] = await tx.select().from(workspaceMembers).where(eq(workspaceMembers.userId, userId)).limit(1);
    if (current && current.status !== "removed") return "already";
    if (current) await tx.update(workspaceMembers).set({ status: "invited", role, invitedBy: actor.userId }).where(eq(workspaceMembers.id, current.id));
    else await tx.insert(workspaceMembers).values({ workspaceId: actor.workspaceId, userId, role, status: "invited", invitedBy: actor.userId });
    const [ws] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, actor.workspaceId)).limit(1);
    const [inviter] = await tx.select({ name: users.name }).from(users).where(eq(users.id, actor.userId)).limit(1);
    await queueNotification(tx, {
      workspaceId: actor.workspaceId,
      userId,
      toEmail: email,
      kind: "invitation",
      dedupeKey: `invite:${userId}:${Date.now()}`,
      subject: `${inviter?.name ?? "A colleague"} invited you to ${ws?.name ?? "a workspace"}`,
      bodyText: `${inviter?.name ?? "A colleague"} invited you to ${ws?.name ?? "a workspace"} on Decision-Maker Intelligence, as ${ROLE_LABELS[role].toLowerCase()}. Sign in with your work account:\n${appLink("/sign-in")}\n\nDecision-Maker Intelligence.`,
    });
    await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "member.invited", entityType: "user", entityId: userId, after: { role, reinvited: !!current } });
    return current ? "reinvited" : "invited";
  });
}

export async function changeMemberRole(tx: Tx, actor: Actor, memberId: string, role: WorkspaceRole): Promise<void> {
  if (!ROLES.includes(role)) throw new MemberError("Choose a role.");
  const m = await loadMember(tx, memberId);
  if (m.userId === actor.userId) throw new MemberError("You cannot change your own role. Ask another member who manages members.");
  if (m.status === "removed") throw new MemberError("This person was removed. Invite them again instead.");
  if (m.role === role) return;
  if (m.role === "partner" && m.status === "active" && (await otherActivePartners(tx, memberId)) === 0) throw new MemberError("A workspace needs at least one partner. Make someone else a partner first.");
  await tx.update(workspaceMembers).set({ role }).where(eq(workspaceMembers.id, memberId));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "member.role_changed", entityType: "user", entityId: m.userId, before: { role: m.role }, after: { role } });
}

export async function removeMember(tx: Tx, actor: Actor, memberId: string): Promise<void> {
  const m = await loadMember(tx, memberId);
  if (m.userId === actor.userId) throw new MemberError("You cannot remove yourself. Ask another member who manages members.");
  if (m.status === "removed") return;
  if (m.role === "partner" && m.status === "active" && (await otherActivePartners(tx, memberId)) === 0) throw new MemberError("A workspace needs at least one partner. Make someone else a partner first.");
  await tx.update(workspaceMembers).set({ status: "removed" }).where(eq(workspaceMembers.id, memberId));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "member.removed", entityType: "user", entityId: m.userId, before: { role: m.role, status: m.status } });
}
