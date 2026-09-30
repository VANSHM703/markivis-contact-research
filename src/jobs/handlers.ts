/** What each built job does. Handlers are idempotent: every job can run twice safely (BRD 19). */
import { and, eq, isNull, notExists, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { withWorkspace } from "@/db/client";
import { persons, roles } from "@/db/schema";
import { refreshPersonStatus } from "@/domain/records";
import { runSource, type SourceRunResult } from "@/ingest/run";
import { log } from "@/lib/log";
import { ACTIVE_JOBS, type IngestJobData } from "./definitions";
import { syncSchedules } from "./schedules";

export async function runIngestJob(sourceName: string, data: IngestJobData): Promise<SourceRunResult> {
  const job = ACTIVE_JOBS.find((j) => j.name === sourceName);
  if (!job?.source) throw new Error(`${sourceName} is not an ingest job.`);
  const apollo = data.personIds || data.companyIds ? { essential: true, personIds: data.personIds, companyIds: data.companyIds } : undefined;
  return runSource(data.workspaceId, job.source, { feedId: data.feedId, apollo });
}

/** People with no current or announced role whose 90 days have passed (BRD 7.3). */
export async function runRecordsStatus(workspaceId: string, today = new Date().toISOString().slice(0, 10)): Promise<number> {
  return withWorkspace(workspaceId, async (tx) => {
    const candidates = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(
        and(
          eq(persons.status, "active"),
          isNull(persons.mergedIntoId),
          notExists(tx.select({ one: sql`1` }).from(roles).where(and(eq(roles.personId, persons.id), sql`${roles.status} in ('current', 'announced')`))),
        ),
      );
    for (const c of candidates) await refreshPersonStatus(tx, c.id, today);
    return candidates.length;
  });
}

/** Registers a worker for every built job. */
export async function registerWorkers(boss: PgBoss): Promise<void> {
  for (const job of ACTIVE_JOBS) {
    await boss.work<IngestJobData>(job.name, { batchSize: 1 }, async ([item]) => {
      if (!item) return;
      const started = Date.now();
      try {
        let result: unknown;
        if (job.source) result = await runIngestJob(job.name, item.data);
        else if (job.name === "records.status") result = { updated: await runRecordsStatus(item.data.workspaceId) };
        else if (job.name === "scheduler.sync") result = await syncSchedules(boss);
        log.info("job.completed", { job: job.name, jobId: item.id, ms: Date.now() - started, result });
        return result;
      } catch (error) {
        log.error("job.failed", { job: job.name, jobId: item.id, ms: Date.now() - started, error: (error as Error).message });
        throw error;
      }
    });
  }
}
