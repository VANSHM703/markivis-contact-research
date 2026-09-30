/**
 * pg-boss, the Postgres-backed job queue (BRD 4.2). It connects as dmi_jobs, which owns only
 * schema pgboss; job handlers reach business data through withWorkspace() like everything else.
 */
import { PgBoss } from "pg-boss";
import { ACTIVE_JOBS } from "./definitions";

export function jobsConnectionString(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.JOBS_DATABASE_URL;
  if (!url) throw new Error("JOBS_DATABASE_URL is not set. See .env.example.");
  return url;
}

/** Retries with backoff; a job that runs longer than 30 minutes is presumed stuck. */
export const QUEUE_DEFAULTS = { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 30 * 60, retentionSeconds: 7 * 24 * 3600 };

export async function createBoss(options: { schedule: boolean; supervise: boolean; connectionString?: string }): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: options.connectionString ?? jobsConnectionString(),
    schema: "pgboss",
    application_name: "dmi-jobs",
    schedule: options.schedule,
    supervise: options.supervise,
    max: 4,
  });
  await boss.start();
  for (const job of ACTIVE_JOBS) {
    if (!(await boss.getQueue(job.name))) await boss.createQueue(job.name, QUEUE_DEFAULTS);
  }
  return boss;
}
