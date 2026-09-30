/** Applies db/migrations as the schema owner (DATABASE_MIGRATE_URL, falling back to DATABASE_URL). */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export async function runMigrations(url = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL): Promise<void> {
  if (!url) throw new Error("Set DATABASE_MIGRATE_URL or DATABASE_URL.");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "db/migrations" });
  } finally {
    await pool.end();
  }
}

/** Drops the dmi schema and the migration journal, then migrates from scratch. Development and tests only. */
export async function resetDatabase(url = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL): Promise<void> {
  if (!url) throw new Error("Set DATABASE_MIGRATE_URL or DATABASE_URL.");
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database.");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("drop schema if exists dmi cascade; drop schema if exists drizzle cascade;");
  } finally {
    await pool.end();
  }
  await runMigrations(url);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const reset = process.argv.includes("--reset");
  (reset ? resetDatabase() : runMigrations())
    .then(() => console.log(reset ? "Database reset and migrated." : "Migrations applied."))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
