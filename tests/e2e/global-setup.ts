import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { E2E_ENV } from "../../playwright.config";

/** Rebuilds dmi_e2e, loads the seed, and saves signed-in sessions for the tests. */
export default async function globalSetup(config: FullConfig) {
  Object.assign(process.env, E2E_ENV);
  const { resetDatabase } = await import("../../scripts/migrate");
  const { loadSeed } = await import("../../src/db/seed");
  const { closeDatabase } = await import("../../src/db/client");
  await resetDatabase(E2E_ENV.DATABASE_MIGRATE_URL);
  const bundle = await loadSeed();
  // Run every mock source and the pipeline, so the queue has items to work (as demo:reset does).
  const { runSource } = await import("../../src/ingest/run");
  const { runPipeline } = await import("../../src/jobs/handlers");
  const demo = bundle.workspaces[0]!.workspace.id;
  for (const source of ["sec_8k", "press_wire", "google_alert", "leadership_page", "leadership_page", "apollo", "newsletter"] as const) await runSource(demo, source, { mode: "mock" });
  await runPipeline(demo);
  const { stageDemoActions } = await import("../../src/db/seed/demo-actions");
  await stageDemoActions(demo);
  await closeDatabase();

  const baseURL = config.projects[0]!.use.baseURL!;
  mkdirSync("tests/e2e/.auth", { recursive: true });
  const browser = await chromium.launch();
  for (const [file, name] of [["partner", "Jordan Ellis"], ["validator", "Sam Okafor"], ["harbor", "Casey Morgan"], ["outreach", "Priya Raman"], ["steward", "Lee Whitford"]] as const) {
    const page = await browser.newPage({ baseURL });
    await page.goto("sign-in");
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page.waitForURL(/\/intelligence\/?$/);
    await page.context().storageState({ path: `tests/e2e/.auth/${file}.json` });
    await page.close();
  }
  await browser.close();
}
