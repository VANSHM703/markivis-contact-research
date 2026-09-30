import type { Tx } from "@/db/client";
import { auditLog } from "@/db/schema";

export interface AuditEntry {
  workspaceId: string | null;
  actorUserId: string | null;
  actorKind: "user" | "system" | "platform_admin";
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/** Appends one audit entry inside the caller's transaction (BRD 18.3). The table is append-only. */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    workspaceId: entry.workspaceId,
    actorUserId: entry.actorUserId,
    actorKind: entry.actorKind,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
  });
}
