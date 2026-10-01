import { defineConfig, devices } from "@playwright/test";

const port = 3300;

/** The BRD 19 speed checks, against a production build and a workspace of 50,000 people. */
export const PERF_ENV = {
  DATA_MODE: "mock",
  APP_BASE_PATH: "/intelligence",
  APP_URL: `http://localhost:${port}`,
  PORT: String(port),
  AUTH_SECRET: "perf-checks-only",
  DATABASE_URL: process.env.PERF_DATABASE_URL ?? "postgres://dmi_app:dmi_app@localhost:5432/dmi_perf",
  DATABASE_MIGRATE_URL: process.env.PERF_DATABASE_MIGRATE_URL ?? "postgres://dmi:dmi@localhost:5432/dmi_perf",
  JOBS_DATABASE_URL: process.env.PERF_JOBS_DATABASE_URL ?? "postgres://dmi_jobs:dmi_jobs@localhost:5432/dmi_perf",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
};

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 40 * 60_000,
  reporter: "list",
  globalSetup: "./global-setup.ts",
  use: { baseURL: `http://localhost:${port}/intelligence/` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm start",
    cwd: "../..",
    url: `http://localhost:${port}/intelligence/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: PERF_ENV,
  },
});
