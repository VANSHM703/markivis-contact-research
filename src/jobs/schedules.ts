/**
 * Keeps pg-boss schedules in step with the workspaces (BRD 8.9): one schedule per job, workspace
 * and slot, in the workspace's own time zone unless the job pins one. Idempotent.
 */
import type { PgBoss } from "pg-boss";
import { withSystem } from "@/db/client";
import { workspaces } from "@/db/schema";
import { ACTIVE_JOBS, scheduleKey } from "./definitions";

export interface SyncResult {
  scheduled: number;
  removed: number;
}

export async function syncSchedules(boss: PgBoss): Promise<SyncResult> {
  const all = await withSystem("scheduler", (tx) => tx.select({ id: workspaces.id, timezone: workspaces.timezone }).from(workspaces));
  let scheduled = 0;
  let removed = 0;
  for (const job of ACTIVE_JOBS) {
    const wanted = new Map<string, { cron: string; tz: string; data: object }>();
    if (job.scope === "platform") {
      for (const s of job.schedules) wanted.set(`platform.${s.slot}`, { cron: s.cron, tz: s.tz ?? "UTC", data: {} });
    } else {
      for (const ws of all) for (const s of job.schedules) wanted.set(scheduleKey(ws.id, s.slot), { cron: s.cron, tz: s.tz ?? ws.timezone, data: { workspaceId: ws.id } });
    }
    const existing = await boss.getSchedules(job.name);
    for (const [key, s] of wanted) {
      const current = existing.find((e) => e.key === key);
      if (current && current.cron === s.cron && current.timezone === s.tz) continue;
      await boss.schedule(job.name, s.cron, s.data, { tz: s.tz, key });
      scheduled++;
    }
    for (const e of existing) {
      if (!wanted.has(e.key)) {
        await boss.unschedule(job.name, e.key);
        removed++;
      }
    }
  }
  return { scheduled, removed };
}
