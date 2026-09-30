import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3100);
const basePath = process.env.APP_BASE_PATH ?? "/intelligence";

/** End-to-end tests run against their own database, rebuilt and seeded in global setup. */
export const E2E_ENV = {
  DATA_MODE: "mock",
  APP_BASE_PATH: basePath,
  APP_URL: `http://localhost:${port}`,
  PORT: String(port),
  AUTH_SECRET: "e2e-tests-only",
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://dmi_app:dmi_app@localhost:5432/dmi_e2e",
  DATABASE_MIGRATE_URL: process.env.E2E_DATABASE_MIGRATE_URL ?? "postgres://dmi:dmi@localhost:5432/dmi_e2e",
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${port}${basePath}/`,
    trace: "retain-on-failure",
    storageState: "tests/e2e/.auth/partner.json",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm start",
    url: `http://localhost:${port}${basePath}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: E2E_ENV,
  },
});
