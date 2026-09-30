/**
 * The notifications outbox (BRD 12.8). `queueNotification` runs inside the caller's transaction,
 * so an alert exists exactly when its event does; `deliverQueued` sends what is waiting. Each row
 * has a dedupe key, so running either twice never sends a message twice.
 */
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { withWorkspace, type Tx } from "@/db/client";
import { notifications, users, workspaceMembers } from "@/db/schema";
import { APP_BASE_PATH } from "@/config/product";
import { log } from "@/lib/log";
import { getMailer, type Mailer } from "./mailer";

export type NotificationKind = (typeof notifications.$inferInsert)["kind"];
type Role = (typeof workspaceMembers.$inferSelect)["role"];

export const MAX_ATTEMPTS = 5;

export interface QueuedNotification {
  workspaceId: string;
  userId: string | null;
  toEmail: string;
  kind: NotificationKind;
  dedupeKey: string;
  subject: string;
  bodyText: string;
}

/** Returns false when a notification with the same key already exists. */
export async function queueNotification(tx: Tx, n: QueuedNotification): Promise<boolean> {
  const rows = await tx.insert(notifications).values(n).onConflictDoNothing({ target: [notifications.workspaceId, notifications.dedupeKey] }).returning({ id: notifications.id });
  return rows.length > 0;
}

export interface Recipient {
  userId: string;
  email: string;
  name: string;
  role: Role;
}

/** Active members holding any of the roles. */
export async function membersWithRoles(tx: Tx, roles: Role[]): Promise<Recipient[]> {
  return tx
    .select({ userId: users.id, email: users.email, name: users.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.status, "active"), inArray(workspaceMembers.role, roles)));
}

/** Absolute link into the app for email bodies. */
export function appLink(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const origin = (env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${origin}${APP_BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

export const EMAIL_FOOTER = "\n\nDecision-Maker Intelligence. You receive this because you are a member of this workspace.";

/** Sends queued notifications for one workspace. A failure is retried on the next run, up to MAX_ATTEMPTS. */
export async function deliverQueued(workspaceId: string, options: { mailer?: Mailer; now?: Date; limit?: number } = {}): Promise<{ sent: number; failed: number }> {
  const now = options.now ?? new Date();
  const pending = await withWorkspace(workspaceId, (tx) =>
    tx
      .select()
      .from(notifications)
      .where(or(eq(notifications.status, "queued"), and(eq(notifications.status, "failed"), lt(notifications.attempts, MAX_ATTEMPTS))))
      .orderBy(asc(notifications.createdAt))
      .limit(options.limit ?? 100),
  );
  if (pending.length === 0) return { sent: 0, failed: 0 };
  let mailer = options.mailer;
  let setupError: string | null = null;
  if (!mailer) {
    try {
      mailer = await getMailer();
    } catch (error) {
      setupError = (error as Error).message;
    }
  }
  let sent = 0;
  let failed = 0;
  for (const n of pending) {
    try {
      if (!mailer) throw new Error(setupError ?? "No mailer.");
      const { messageId } = await mailer.send({ to: n.toEmail, subject: n.subject, text: n.bodyText });
      await withWorkspace(workspaceId, (tx) => tx.update(notifications).set({ status: "sent", sentAt: now, providerMessageId: messageId, attempts: sql`${notifications.attempts} + 1`, error: null }).where(eq(notifications.id, n.id)));
      sent++;
    } catch (error) {
      const message = (error as Error).message.slice(0, 1000);
      await withWorkspace(workspaceId, (tx) => tx.update(notifications).set({ status: "failed", attempts: sql`${notifications.attempts} + 1`, error: message }).where(eq(notifications.id, n.id)));
      log.error("mail.failed", { workspaceId, notificationId: n.id, kind: n.kind, error: message });
      failed++;
    }
  }
  return { sent, failed };
}
