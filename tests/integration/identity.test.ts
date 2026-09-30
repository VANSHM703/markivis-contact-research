/** Sign-in resolution against the allow-list (BRD 5.2). */
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase, withSystem } from "@/db/client";
import { auditLog, users, workspaceMembers } from "@/db/schema";
import { DOMAIN_ALLOW_LIST_ROLE, listMemberships, resolveSignIn } from "@/lib/identity";

afterAll(() => closeDatabase());

describe("resolveSignIn", () => {
  it("signs in an existing member and records the sign-in in the audit log", async () => {
    const result = await resolveSignIn({ email: "Jordan.Ellis@demo-search.example.com", amr: ["mfa"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entries = await withSystem("test", (tx) =>
      tx.select().from(auditLog).where(and(eq(auditLog.actorUserId, result.userId), eq(auditLog.action, "auth.sign_in"))),
    );
    expect(entries.length).toBeGreaterThan(0);
    const [user] = await withSystem("test", (tx) => tx.select().from(users).where(eq(users.id, result.userId)));
    expect(user?.lastAmr).toEqual(["mfa"]);
  });

  it("gives someone from an allowed domain a least-privilege membership", async () => {
    const result = await resolveSignIn({ email: "new.colleague@demo-search.example.com", name: "New Colleague" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const memberships = await listMemberships(result.userId);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe(DOMAIN_ALLOW_LIST_ROLE);
  });

  it("refuses an address that is neither invited nor on an allowed domain", async () => {
    expect(await resolveSignIn({ email: "someone@unlisted.example.net" })).toEqual({ ok: false, reason: "not_allowed" });
    const [user] = await withSystem("test", (tx) => tx.select().from(users).where(eq(users.email, "someone@unlisted.example.net")));
    expect(user).toBeUndefined();
  });

  it("activates a pending invitation on first sign-in", async () => {
    const invitedId = await withSystem("test", async (tx) => {
      const [user] = await tx.insert(users).values({ email: "invited@outside.example.net", name: "Invited Person" }).returning();
      const [ws] = await tx.select({ id: workspaceMembers.workspaceId }).from(workspaceMembers).limit(1);
      await tx.insert(workspaceMembers).values({ workspaceId: ws!.id, userId: user!.id, role: "validator", status: "invited" });
      return user!.id;
    });
    const result = await resolveSignIn({ email: "invited@outside.example.net" });
    expect(result).toEqual({ ok: true, userId: invitedId });
    const memberships = await listMemberships(invitedId);
    expect(memberships.map((m) => m.role)).toEqual(["validator"]);
  });

  it("lists every workspace for a user who belongs to two", async () => {
    const result = await resolveSignIn({ email: "sam.okafor@markivis.example.com" });
    if (!result.ok) throw new Error("expected sign-in");
    const memberships = await listMemberships(result.userId);
    expect(memberships.map((m) => m.workspaceName)).toEqual(["Demo Search Partners", "Harbor Search Group"]);
  });
});
