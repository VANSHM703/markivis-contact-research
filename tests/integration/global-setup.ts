import { TEST_DATABASE_ENV, SEED_NOW } from "./env";

/** Rebuilds dmi_test from scratch and loads the seed once per test run. */
export default async function setup() {
  Object.assign(process.env, TEST_DATABASE_ENV);
  const { resetDatabase } = await import("../../scripts/migrate");
  const { loadSeed } = await import("../../src/db/seed");
  const { closeDatabase } = await import("../../src/db/client");
  await resetDatabase(TEST_DATABASE_ENV.DATABASE_MIGRATE_URL);
  await loadSeed(SEED_NOW);
  await closeDatabase();
}
