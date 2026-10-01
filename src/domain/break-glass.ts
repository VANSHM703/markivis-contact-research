/**
 * Platform administration and break-glass access (BRD 5.3, 18.3).
 *
 * A platform admin sees every workspace's packs, flags, members count, usage and cost, but reads
 * no workspace data. To read one they are not a member of, they open break-glass access: a stated
 * reason, a time limit of at most two hours, and read-only (the account lead role, which can only
 * view records). Opening and ending it are written to that workspace's audit log, and its data
 * stewards are emailed at once. The platform-wide reads here run as dmi_system with the reason
 * "platform_admin"; everything inside the workspace runs in its own scope.
 */
import { and, eq, sql } from "drizzle-orm";
import { withSystem, withWorkspace } from "@/db/client";
import { breakGlassGrants, users, workspaceMembers, workspaces } from "@/db/schema";
import { audit } from "@/lib/audit";
import { appLink, EMAIL_FOOTER, membersWithRoles, queueNotification } from "@/mail/notify";

export const BREAK_GLASS_MINUTES = [30, 60, 120] as const;

export class BreakGlassError extends Error {}

async function requirePlatformAdmin(userId: string): Promise<{ name: string }> {
  const [user] = await withSystem("platform_admin", (tx) => tx.select({ name: users.name, admin: users.isPlatformAdmin }).from(users).where(eq(users.id, userId)).limit(1));
  if (!user?.admin) throw new BreakGlassError("Only a platform admin can do this.");
  return { name: user.name };
}

export interface WorkspaceOverview {
  id: string;
  name: string;
  slug: string;
  members: number;
  packs: Record<string, boolean>;
  flags: Record<string, boolean>;
  aiSpendUsd: number;
  apolloCredits: number;
  isMember: boolean;
  grant: { id: string; expiresAt: Date } | null;
}

/** Every workspace with usage and cost for this month. No workspace data. */
export async function platformOverview(userId: string, now = new Date()): Promise<WorkspaceOverview[]> {
  await requirePlatformAdmin(userId);
  const period = now.toISOString().slice(0, 7);
  const monthStart = `${period}-01T00:00:00Z`;
  const rows = await withSystem("platform_admin", (tx) =>
    tx.execute<{ id: string; name: string; slug: string; packs: Record<string, boolean>; flags: Record<string, boolean>; members: number; ai: string | null; apollo: number | null; is_member: boolean; grant_id: string | null; grant_expires: string | null }>(sql`
      select w.id, w.name, w.slug, w.packs, w.flags,
        (select count(*)::int from dmi.workspace_members m where m.workspace_id = w.id and m.status = 'active') as members,
        (select sum(a.cost_usd) from dmi.ai_calls a where a.workspace_id = w.id and a.created_at >= ${monthStart}::timestamptz) as ai,
        (select u.units from dmi.usage_counters u where u.workspace_id = w.id and u.provider = 'apollo' and u.period = ${period}) as apollo,
        exists (select 1 from dmi.workspace_members m where m.workspace_id = w.id and m.user_id = ${userId}::uuid and m.status = 'active') as is_member,
        g.id as grant_id, g.expires_at as grant_expires
      from dmi.workspaces w
      left join lateral (
        select id, expires_at from dmi.break_glass_grants b
        where b.workspace_id = w.id and b.user_id = ${userId}::uuid and b.ended_at is null and b.expires_at > ${now.toISOString()}::timestamptz
        order by expires_at desc limit 1
      ) g on true
      order by w.name`),
  );
  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    members: r.members,
    packs: r.packs,
    flags: r.flags,
    aiSpendUsd: Number(r.ai ?? 0),
    apolloCredits: r.apollo ?? 0,
    isMember: r.is_member,
    grant: r.grant_id ? { id: r.grant_id, expiresAt: new Date(r.grant_expires!) } : null,
  }));
}

export async function startBreakGlass(userId: string, workspaceId: string, reasonInput: string, minutes: number, now = new Date()): Promise<{ grantId: string; expiresAt: Date }> {
  const admin = await requirePlatformAdmin(userId);
  const reason = reasonInput.trim();
  if (reason.length < 10 || reason.length > 500) throw new BreakGlassError("Give the reason in 10 to 500 characters, for example the support ticket and what you need to check.");
  if (!(BREAK_GLASS_MINUTES as readonly number[]).includes(minutes)) throw new BreakGlassError("Choose how long you need.");
  const expiresAt = new Date(now.getTime() + minutes * 60_000);
  return withWorkspace(workspaceId, async (tx) => {
    const [ws] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!ws) throw new BreakGlassError("Workspace not found.");
    const [member] = await tx.select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.status, "active"))).limit(1);
    if (member) throw new BreakGlassError("You are a member of this workspace, so no break-glass access is needed.");
    const [grant] = await tx.insert(breakGlassGrants).values({ workspaceId, userId, reason, expiresAt }).returning({ id: breakGlassGrants.id });
    await audit(tx, { workspaceId, actorUserId: userId, actorKind: "platform_admin", action: "platform_admin.break_glass_started", entityType: "break_glass_grant", entityId: grant!.id, after: { admin: admin.name, reason, minutes, expires_at: expiresAt.toISOString(), read_only: true } });
    for (const steward of await membersWithRoles(tx, ["data_steward"])) {
      await queueNotification(tx, {
        workspaceId,
        userId: steward.userId,
        toEmail: steward.email,
        kind: "break_glass",
        dedupeKey: `break_glass:${grant!.id}:${steward.userId}`,
        subject: `Break-glass access to ${ws.name} by ${admin.name}`,
        bodyText: `${admin.name}, a Markivis platform admin, opened read-only access to ${ws.name} for ${minutes} minutes.\n\nReason given: ${reason}\n\nIt ends at ${expiresAt.toISOString().slice(11, 16)} UTC and is in the audit log:\n${appLink("/settings/audit?action=platform_admin")}${EMAIL_FOOTER}`,
      });
    }
    return { grantId: grant!.id, expiresAt };
  });
}

export async function endBreakGlass(userId: string, grantId: string, now = new Date()): Promise<void> {
  const admin = await requirePlatformAdmin(userId);
  const [grant] = await withSystem("platform_admin", (tx) => tx.select({ workspaceId: breakGlassGrants.workspaceId, userId: breakGlassGrants.userId, endedAt: breakGlassGrants.endedAt }).from(breakGlassGrants).where(eq(breakGlassGrants.id, grantId)).limit(1));
  if (!grant || grant.userId !== userId) throw new BreakGlassError("Grant not found.");
  if (grant.endedAt) return;
  await withWorkspace(grant.workspaceId, async (tx) => {
    await tx.update(breakGlassGrants).set({ endedAt: now }).where(eq(breakGlassGrants.id, grantId));
    await audit(tx, { workspaceId: grant.workspaceId, actorUserId: userId, actorKind: "platform_admin", action: "platform_admin.break_glass_ended", entityType: "break_glass_grant", entityId: grantId, after: { admin: admin.name } });
  });
}
