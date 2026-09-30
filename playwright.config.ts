import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3100);
const basePath = process.env.APP_BASE_PATH ?? "/intelligence";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}${basePath}/`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm start",
    url: `http://localhost:${port}${basePath}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { DATA_MODE: "mock", APP_BASE_PATH: basePath, PORT: String(port) },
  },
});
