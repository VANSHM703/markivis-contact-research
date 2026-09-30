/** Integration tests use a separate database (dmi_test), created by db/bootstrap.sql. */
export const TEST_DATABASE_ENV = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://dmi_app:dmi_app@localhost:5432/dmi_test",
  DATABASE_MIGRATE_URL: process.env.TEST_DATABASE_MIGRATE_URL ?? "postgres://dmi:dmi@localhost:5432/dmi_test",
  JOBS_DATABASE_URL: process.env.TEST_JOBS_DATABASE_URL ?? "postgres://dmi_jobs:dmi_jobs@localhost:5432/dmi_test",
  DATA_MODE: "mock",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  AUTH_SECRET: "integration-tests-only",
};

/** Fixed clock for the seed, so counts and dates are stable. */
export const SEED_NOW = new Date("2026-09-30T12:00:00Z");
