/**
 * The only way application code reaches the database (BRD 5.1).
 *
 * - withWorkspace(): a transaction with app.workspace_id set, so row-level security limits every
 *   statement to that workspace. This is the normal path for all request and job code.
 * - withSystem(): a transaction as dmi_system (BYPASSRLS) for the few operations that must span
 *   workspaces: sign-in identity lookup, the scheduler, seeding. Each call names its reason.
 *
 * The raw pool and Drizzle instance are not exported, so an unscoped query cannot be written.
 */
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const globalForDb = globalThis as unknown as { dmiPool?: Pool; dmiDb?: Database };

function database(): Database {
  if (!globalForDb.dmiDb) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and set it.");
    globalForDb.dmiPool = new Pool({ connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
    globalForDb.dmiDb = drizzle(globalForDb.dmiPool, { schema, casing: "snake_case" });
  }
  return globalForDb.dmiDb;
}

export class MissingWorkspaceScopeError extends Error {
  constructor() {
    super("Refusing to run a query without a valid workspace scope.");
  }
}

export async function withWorkspace<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (typeof workspaceId !== "string" || !UUID_RE.test(workspaceId)) throw new MissingWorkspaceScopeError();
  return database().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
  });
}

export type SystemReason = "identity" | "scheduler" | "seed" | "platform_admin" | "test";

export async function withSystem<T>(reason: SystemReason, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return database().transaction(async (tx) => {
    await tx.execute(sql`set local role dmi_system`);
    await tx.execute(sql`select set_config('app.system_reason', ${reason}, true)`);
    return fn(tx);
  });
}

/** Closes the pool. Scripts and tests call this before exiting. */
export async function closeDatabase(): Promise<void> {
  await globalForDb.dmiPool?.end();
  globalForDb.dmiPool = undefined;
  globalForDb.dmiDb = undefined;
}

export { schema };
