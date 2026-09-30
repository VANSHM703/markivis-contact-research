/** Immediate alerts (BRD 12.8), queued in the caller's transaction and sent by notifications.send. */
import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { users, workspaces } from "@/db/schema";
import { appLink, EMAIL_FOOTER, membersWithRoles, queueNotification } from "./notify";

async function workspaceName(tx: Tx, workspaceId: string): Promise<string> {
  const [ws] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return ws?.name ?? "your workspace";
}

/** AI or Apollo spend reached 80% of its monthly cap: the data steward and platform admins. */
export async function alertBudget80(tx: Tx, workspaceId: string, what: "AI" | "Apollo", used: string, cap: string, period: string): Promise<void> {
  const name = await workspaceName(tx, workspaceId);
  const stewards = await membersWithRoles(tx, ["data_steward"]);
  const admins = await tx.select({ userId: users.id, email: users.email }).from(users).where(eq(users.isPlatformAdmin, true));
  const recipients = new Map([...stewards, ...admins].map((r) => [r.userId, r.email]));
  for (const [userId, email] of recipients) {
    await queueNotification(tx, {
      workspaceId,
      userId,
      toEmail: email,
      kind: "budget_80",
      dedupeKey: `budget_80:${what.toLowerCase()}:${period}:${userId}`,
      subject: `${what} budget at 80% in ${name}`,
      bodyText: `${name} has used ${used} of its ${cap} monthly ${what} budget for ${period}.\n\n${what === "AI" ? "At 100%, research, automatic briefs and priority 2 drafts pause until the first of next month. Extraction and priority 1 drafts continue." : "At 100%, only essential Apollo lookups continue until the first of next month."}\n\nRaise the cap in Settings: ${appLink("/settings")}${EMAIL_FOOTER}`,
    });
  }
}

/** Auto-confirm suspended for a source type: the partner and data steward. */
export async function alertAutoConfirmSuspended(tx: Tx, workspaceId: string, sourceLabel: string, sourceType: string, since: string): Promise<void> {
  const name = await workspaceName(tx, workspaceId);
  for (const r of await membersWithRoles(tx, ["partner", "data_steward"])) {
    await queueNotification(tx, {
      workspaceId,
      userId: r.userId,
      toEmail: r.email,
      kind: "auto_confirm_suspended",
      dedupeKey: `suspended:${sourceType}:${since}:${r.userId}`,
      subject: `Auto-confirm suspended for ${sourceLabel} in ${name}`,
      bodyText: `Spot checks found errors above the limit in automatic confirmations from ${sourceLabel}. New items from this source now wait for review.\n\nReview the spot checks, then re-enable auto-confirm from Today when you are satisfied: ${appLink("/queue?tab=spot")}${EMAIL_FOOTER}`,
    });
  }
}
