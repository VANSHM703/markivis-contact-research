/** Service levels (BRD 12.8): an open action overdue by one working day is escalated once. */
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { withWorkspace } from "@/db/client";
import { actions, workspaces } from "@/db/schema";
import { audit } from "@/lib/audit";
import { escalatesAt } from "@/lib/working-days";
import { OPEN_STATUSES } from "./actions";

export async function runSla(workspaceId: string, now = new Date()): Promise<{ escalated: number }> {
  return withWorkspace(workspaceId, async (tx) => {
    const [ws] = await tx.select({ timezone: workspaces.timezone, settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const days = (ws!.settings as { working_days?: string[] }).working_days;
    const overdue = await tx
      .select({ id: actions.id, dueAt: actions.dueAt })
      .from(actions)
      .where(and(inArray(actions.status, [...OPEN_STATUSES]), isNull(actions.escalatedAt), lt(actions.dueAt, now)));
    let escalated = 0;
    for (const a of overdue) {
      if (now < escalatesAt(a.dueAt, ws!.timezone, days)) continue;
      await tx.update(actions).set({ escalatedAt: now }).where(eq(actions.id, a.id));
      await audit(tx, { workspaceId, actorUserId: null, actorKind: "system", action: "action.escalated", entityType: "action", entityId: a.id, after: { due_at: a.dueAt.toISOString() } });
      escalated++;
    }
    return { escalated };
  });
}
