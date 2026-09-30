/**
 * Deploy-time setup: apply migrations, then in mock mode load the seed if the database is empty.
 * Used by docker compose (the "setup" service) and safe to run repeatedly.
 */
import { sql } from "drizzle-orm";
import { getDataMode } from "@/config/env";
import { closeDatabase, withSystem } from "@/db/client";
import { loadSeed } from "@/db/seed";
import { runMigrations } from "./migrate";

async function main() {
  await runMigrations();
  console.log("Migrations applied.");
  if (getDataMode() !== "mock") return;
  const count = await withSystem("seed", async (tx) => {
    const result = await tx.execute<{ n: number }>(sql`select count(*)::int as n from dmi.workspaces`);
    return result.rows[0]?.n ?? 0;
  });
  if (count > 0) {
    console.log("Seed already loaded.");
    return;
  }
  await loadSeed();
  console.log("Seed workspaces loaded. Open /intelligence/sign-in to continue as a demo user.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
