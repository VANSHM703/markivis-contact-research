/**
 * Stages the demo's actions after the pipeline has run (BRD 21: every screen populated), so the
 * Actions screen, Today and the digest show each state: one draft awaiting approval, one email
 * already sent, one escalated, and one blocked until a lawful basis is recorded. Mock mode only.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { actions, consents, drafts, persons, workspaceMembers } from "@/db/schema";
import { approveAndSend, submitForApproval, type FlowActor } from "@/domain/action-flow";
import { createManualAction, dueDate } from "@/domain/actions";
import { runSla } from "@/domain/sla";
import { runDigest } from "@/digest/digest";
import { addWorkingDays } from "@/lib/working-days";
import { mockMailboxSender } from "@/outreach/mailbox";

export interface StagedActions {
  awaitingApproval: string | null;
  sent: string | null;
  escalated: string | null;
  lawfulBasis: string | null;
}

export async function stageDemoActions(workspaceId: string, now = new Date()): Promise<StagedActions> {
  const { members, emailActions } = await withWorkspace(workspaceId, async (tx) => ({
    members: await tx.select({ userId: workspaceMembers.userId, role: workspaceMembers.role }).from(workspaceMembers),
    emailActions: await tx
      .selectDistinct({ id: actions.id, dueAt: actions.dueAt })
      .from(actions)
      .innerJoin(drafts, eq(drafts.actionId, actions.id))
      .where(and(eq(actions.status, "drafted"), eq(drafts.channel, "email")))
      .orderBy(asc(actions.dueAt), asc(actions.id)),
  }));
  const actor = (role: FlowActor["role"]): FlowActor | null => {
    const m = members.find((x) => x.role === role);
    return m ? { workspaceId, userId: m.userId, role } : null;
  };
  const partner = actor("partner");
  const outreach = actor("outreach_owner");
  const staged: StagedActions = { awaitingApproval: null, sent: null, escalated: null, lawfulBasis: null };
  if (!partner) return staged;

  const [first, second, third] = emailActions;
  if (first && outreach) {
    await withWorkspace(workspaceId, (tx) => submitForApproval(tx, outreach, first.id));
    staged.awaitingApproval = first.id;
  }
  if (second) {
    await approveAndSend(partner, second.id, { sender: mockMailboxSender(), now });
    staged.sent = second.id;
  }
  if (third) {
    await withWorkspace(workspaceId, (tx) => tx.update(actions).set({ dueAt: addWorkingDays(now, -3) }).where(eq(actions.id, third.id)));
    staged.escalated = third.id;
  }

  // A person in Germany with no lawful basis recorded: the action exists, drafting is blocked.
  staged.lawfulBasis = await withWorkspace(workspaceId, async (tx) => {
    const [de] = await tx
      .select({ id: persons.id })
      .from(persons)
      .innerJoin(consents, and(eq(consents.personId, persons.id), eq(consents.channel, "email"), eq(consents.purpose, "outreach"), eq(consents.status, "unknown")))
      .where(and(eq(persons.country, "DE"), eq(persons.status, "active"), sql`not exists (select 1 from dmi.actions a where a.person_id = ${persons.id} and a.status in ('open', 'drafted', 'awaiting_approval', 'approved'))`))
      .limit(1);
    if (!de) return null;
    const created = await createManualAction(tx, partner, {
      personId: de.id,
      type: "check_in",
      purpose: "client",
      ownerUserId: partner.userId,
      dueAt: dueDate({ priority: 2, type: "other", effectiveOn: null }, now, {}, "America/New_York"),
      headline: "Reconnect before the European leadership summit",
    });
    return "actionId" in created ? created.actionId : null;
  });

  await runSla(workspaceId, now);
  await runDigest(workspaceId, { now });
  return staged;
}
