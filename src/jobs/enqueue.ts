/**
 * Sending jobs from the web app (Run now, on-demand Apollo enrichment). The web process keeps
 * one sending-only pg-boss instance: it neither schedules nor supervises; the worker does.
 */
import type { PgBoss } from "pg-boss";
import { log } from "@/lib/log";
import { createBoss } from "./boss";
import type { IngestJobData } from "./definitions";

const globalForBoss = globalThis as unknown as { dmiSender?: Promise<PgBoss> };

function sender(): Promise<PgBoss> {
  globalForBoss.dmiSender ??= createBoss({ schedule: false, supervise: false }).catch((error: unknown) => {
    globalForBoss.dmiSender = undefined;
    throw error;
  });
  return globalForBoss.dmiSender;
}

/** Queues a job; one per workspace and job name at a time, so double clicks do not pile up. */
export async function enqueue(name: string, data: IngestJobData): Promise<string | null> {
  try {
    const boss = await sender();
    return await boss.send(name, data, { singletonKey: `${data.workspaceId}.${data.feedId ?? "all"}`, singletonSeconds: 60 });
  } catch (error) {
    log.error("job.enqueue_failed", { job: name, error: (error as Error).message });
    throw new Error("Couldn't queue the job. Check that the job database is reachable.");
  }
}

/** For follow-up work that must never fail the user's action, such as on-demand enrichment. */
export async function enqueueQuietly(name: string, data: IngestJobData): Promise<void> {
  if (!process.env.JOBS_DATABASE_URL) return;
  try {
    await enqueue(name, data);
  } catch {
    // Logged in enqueue(); the weekly sweep catches anything missed.
  }
}
