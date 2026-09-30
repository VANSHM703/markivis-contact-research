/**
 * The worker process (BRD 4.3): runs queued jobs and the schedule. Scales horizontally; every
 * job is idempotent. Start with `npm run worker`.
 */
import { closeDatabase } from "@/db/client";
import { createBoss } from "@/jobs/boss";
import { registerWorkers } from "@/jobs/handlers";
import { syncSchedules } from "@/jobs/schedules";
import { log } from "@/lib/log";

async function main() {
  const boss = await createBoss({ schedule: true, supervise: true });
  boss.on("error", (error: Error) => log.error("jobs.error", { error: error.message }));
  const synced = await syncSchedules(boss);
  await registerWorkers(boss);
  log.info("worker.started", synced as unknown as Record<string, unknown>);

  const stop = async (signal: string) => {
    log.info("worker.stopping", { signal });
    await boss.stop({ graceful: true, timeout: 30_000 });
    await closeDatabase();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}

main().catch((error: unknown) => {
  log.error("worker.crashed", { error: (error as Error).stack ?? String(error) });
  process.exit(1);
});
