/** The email log for Settings (BRD 12.8): digests and alerts, newest first. */
import { desc, eq } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { notifications } from "@/db/schema";
import { UUID_RE } from "./guards";

export async function listNotifications(workspaceId: string, limit = 100) {
  return withWorkspace(workspaceId, (tx) =>
    tx
      .select({ id: notifications.id, kind: notifications.kind, toEmail: notifications.toEmail, subject: notifications.subject, status: notifications.status, error: notifications.error, sentAt: notifications.sentAt, createdAt: notifications.createdAt })
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
  );
}

export async function getNotification(workspaceId: string, id: string) {
  if (!UUID_RE.test(id)) return null;
  return withWorkspace(workspaceId, async (tx) => (await tx.select().from(notifications).where(eq(notifications.id, id)).limit(1))[0] ?? null);
}
