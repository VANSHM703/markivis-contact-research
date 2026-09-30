/**
 * Stages activity capture for the demo (BRD 21): Jordan's demo Microsoft 365 mailbox is
 * connected and synced, and one captured thread is marked private, so the Interactions tab shows
 * captured mail, a meeting and a private thread. Mock mode only.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { interactions, users, workspaceMembers } from "@/db/schema";
import { runCalendarCapture, runMailCapture } from "@/capture/capture";
import { saveConnection } from "@/capture/connections";
import { setThreadPrivate } from "@/capture/privacy";

export async function stageDemoCapture(workspaceId: string, now = new Date()): Promise<{ mail: number; meetings: number }> {
  const partner = await withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx.select({ id: users.id, email: users.email }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId)).where(eq(workspaceMembers.role, "partner")).limit(1);
    return row!;
  });
  const connectionId = await withWorkspace(workspaceId, (tx) => saveConnection(tx, { workspaceId, userId: partner.id, provider: "microsoft", accountEmail: partner.email, tokens: null, mock: true }));
  const mail = await runMailCapture(workspaceId, { connectionId, now });
  const calendar = await runCalendarCapture(workspaceId, { connectionId, now });
  await withWorkspace(workspaceId, async (tx) => {
    const [thread] = await tx
      .select({ key: interactions.threadKey })
      .from(interactions)
      .where(and(eq(interactions.capturedBy, "auto"), eq(interactions.channel, "email"), isNotNull(interactions.threadKey)))
      .limit(1);
    if (thread?.key) await setThreadPrivate(tx, { workspaceId, userId: partner.id, role: "partner" }, thread.key, true);
  });
  return { mail: mail.created, meetings: calendar.meetings };
}
