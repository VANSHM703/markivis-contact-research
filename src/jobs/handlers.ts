/** What each built job does. Handlers are idempotent: every job can run twice safely (BRD 19). */
import { and, eq, isNull, notExists, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { withWorkspace } from "@/db/client";
import { persons, roles } from "@/db/schema";
import { recomputePrimaryRole, refreshPersonStatus } from "@/domain/records";
import { runSource, type SourceRunResult } from "@/ingest/run";
import { raiseDerivedSignals } from "@/pipeline/derived";
import { processPending } from "@/pipeline/process";
import { completeResearch, recomputeAllStats, sampleSpotChecks } from "@/pipeline/validation";
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
    // Announced roles become current on their effective date (BRD 7.3, acceptance scenario 6).
    const started = await tx
      .update(roles)
      .set({ status: "current" })
      .where(and(eq(roles.status, "announced"), sql`${roles.effectiveOn} <= ${today}::date`))
      .returning({ personId: roles.personId });
    for (const r of started) await recomputePrimaryRole(tx, r.personId);
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

/** Drains the pipeline for a workspace, then raises rule-based signals (BRD 9.1, 9.3). */
export async function runPipeline(workspaceId: string, maxBatches = 20): Promise<{ processed: number; derived: number }> {
  let processed = 0;
  for (let i = 0; i < maxBatches; i++) {
    const batch = await processPending(workspaceId);
    processed += batch.processed.length;
    if (batch.remaining === 0 || batch.processed.length === 0) break;
  }
  const derived = await withWorkspace(workspaceId, (tx) => raiseDerivedSignals(tx, workspaceId));
  return { processed, derived };
}

/** Registers a worker for every built job. */
export async function registerWorkers(boss: PgBoss): Promise<void> {
  for (const job of ACTIVE_JOBS) {
    await boss.work<IngestJobData>(job.name, { batchSize: 1 }, async ([item]) => {
      if (!item) return;
      const started = Date.now();
      try {
        let result: unknown;
        const ws = item.data.workspaceId;
        if (job.source) {
          const run = await runIngestJob(job.name, item.data);
          // New raw items go straight to the pipeline (BRD 8.9: triggered by new raw items).
          if (run.feeds.some((f) => f.created > 0)) await boss.send("pipeline.process", { workspaceId: ws }, { singletonKey: ws, singletonSeconds: 30 });
          result = run;
        } else if (job.name === "pipeline.process") result = await runPipeline(ws);
        else if (job.name === "pipeline.research" && item.data.signalId) result = await completeResearch(ws, item.data.signalId);
        else if (job.name === "validation.spot_check") result = { sampled: await withWorkspace(ws, (tx) => sampleSpotChecks(tx, ws)) };
        else if (job.name === "stats.sources") result = await withWorkspace(ws, (tx) => recomputeAllStats(tx, ws));
        else if (job.name === "records.status") result = { updated: await runRecordsStatus(ws) };
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
