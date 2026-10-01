import { defineConfig, devices } from "@playwright/test";

/** Acceptance scenario 24, against a stack already started with docker compose up. */
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: process.env.COMPOSE_URL ?? "http://localhost:3000/intelligence/", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
