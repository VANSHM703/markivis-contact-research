/** The job queue and schedule (BRD 8.9) against real pg-boss, connected as dmi_jobs. */
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, withSystem } from "@/db/client";
import * as s from "@/db/schema";
import { createBoss } from "@/jobs/boss";
import { ACTIVE_JOBS, scheduleKey } from "@/jobs/definitions";
import { registerWorkers, runRecordsStatus } from "@/jobs/handlers";
import { syncSchedules } from "@/jobs/schedules";
import { loadFixtures, type WorkspaceFixture } from "./helpers";

let boss: PgBoss;
let demo: WorkspaceFixture;
let harbor: WorkspaceFixture;

beforeAll(async () => {
  ({ demo, harbor } = await loadFixtures());
  boss = await createBoss({ schedule: false, supervise: false });
  for (const job of ACTIVE_JOBS) for (const sch of await boss.getSchedules(job.name)) await boss.unschedule(job.name, sch.key);
});
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closeDatabase();
});

const perWorkspace = ACTIVE_JOBS.filter((j) => j.scope === "workspace").reduce((n, j) => n + j.schedules.length, 0);
const platform = ACTIVE_JOBS.filter((j) => j.scope === "platform").reduce((n, j) => n + j.schedules.length, 0);

describe("schedules", () => {
  it("creates one schedule per job, workspace and slot, and changes nothing the second time", async () => {
    expect(await syncSchedules(boss)).toEqual({ scheduled: perWorkspace * 2 + platform, removed: 0 });
    expect(await syncSchedules(boss)).toEqual({ scheduled: 0, removed: 0 });
  });

  it("uses the workspace's time zone, except where the job pins one", async () => {
    const [wires] = await boss.getSchedules("ingest.wires", scheduleKey(demo.id, "every30"));
    expect(wires).toMatchObject({ cron: "*/30 * * * *", timezone: "America/New_York", data: { workspaceId: demo.id } });
    const sec = await boss.getSchedules("ingest.sec");
    expect(sec.filter((x) => x.key.startsWith(harbor.id)).map((x) => x.cron).sort()).toEqual(["*/30 6-21 * * 1-5", "0 */2 * * 0,6", "0 0,2,4,22 * * 1-5"]);
    const [sync] = await boss.getSchedules("scheduler.sync");
    expect(sync).toMatchObject({ key: "platform.every10", timezone: "UTC" });
  });

  it("follows a workspace's time zone change and removes schedules of workspaces that no longer exist", async () => {
    await withSystem("test", (tx) => tx.update(s.workspaces).set({ timezone: "America/Chicago" }).where(eq(s.workspaces.id, harbor.id)));
    await boss.schedule("ingest.wires", "*/30 * * * *", { workspaceId: "gone" }, { key: "00000000-0000-4000-8000-000000000000.every30" });
    try {
      const result = await syncSchedules(boss);
      expect(result.removed).toBe(1);
      expect(result.scheduled).toBe(ACTIVE_JOBS.flatMap((j) => (j.scope === "workspace" ? j.schedules.filter((x) => !x.tz) : [])).length);
      const [wires] = await boss.getSchedules("ingest.wires", scheduleKey(harbor.id, "every30"));
      expect(wires!.timezone).toBe("America/Chicago");
    } finally {
      await withSystem("test", (tx) => tx.update(s.workspaces).set({ timezone: "America/New_York" }).where(eq(s.workspaces.id, harbor.id)));
      await syncSchedules(boss);
    }
  });
});

describe("worker", () => {
  it("runs a queued ingest job end to end", async () => {
    await registerWorkers(boss);
    try {
      const id = await boss.send("ingest.wires", { workspaceId: harbor.id });
      expect(id).toBeTruthy();
      const deadline = Date.now() + 20_000;
      let count = 0;
      while (Date.now() < deadline) {
        count = (await withSystem("test", (tx) => tx.select({ id: s.rawItems.id }).from(s.rawItems).where(eq(s.rawItems.workspaceId, harbor.id)))).length;
        if (count > 0) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(count).toBe(20);
    } finally {
      for (const job of ACTIVE_JOBS) await boss.offWork(job.name);
      await withSystem("test", (tx) => tx.delete(s.rawItems).where(eq(s.rawItems.workspaceId, harbor.id)));
      await withSystem("test", (tx) => tx.update(s.feeds).set({ lastRunAt: null, lastSuccessAt: null, lastError: null, consecutiveFailures: 0 }).where(eq(s.feeds.workspaceId, harbor.id)));
    }
  });

  it("records.status is idempotent: a second run changes nothing", async () => {
    await runRecordsStatus(demo.id);
    const before = await withSystem("test", (tx) => tx.select({ id: s.persons.id, status: s.persons.status }).from(s.persons).where(eq(s.persons.workspaceId, demo.id)));
    await runRecordsStatus(demo.id);
    const after = await withSystem("test", (tx) => tx.select({ id: s.persons.id, status: s.persons.status }).from(s.persons).where(eq(s.persons.workspaceId, demo.id)));
    expect(after).toEqual(before);
  });
});
