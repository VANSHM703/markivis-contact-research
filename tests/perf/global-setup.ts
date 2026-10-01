import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { PERF_ENV } from "./perf.config";

/** Rebuilds dmi_perf, loads the seed, fills the demo workspace to 50,000 people, and signs in. */
export default async function globalSetup(config: FullConfig) {
  Object.assign(process.env, PERF_ENV);
  const { resetDatabase } = await import("../../scripts/migrate");
  const { loadSeed } = await import("../../src/db/seed");
  const { closeDatabase } = await import("../../src/db/client");
  const { fillToScale } = await import("./scale");
  await resetDatabase(PERF_ENV.DATABASE_MIGRATE_URL);
  const bundle = await loadSeed();
  const demo = bundle.workspaces[0]!;
  const partner = demo.members.find((m) => m.role === "partner")!;
  const scale = await fillToScale(PERF_ENV.DATABASE_MIGRATE_URL, demo.workspace.id, partner.userId);
  await closeDatabase();
  mkdirSync("tests/perf/.auth", { recursive: true });
  writeFileSync("tests/perf/.auth/scale.json", JSON.stringify(scale));
  console.log(`Scale: ${scale.people} people and ${scale.companies} companies in ${Math.round(scale.ms / 1000)} s.`);

  const browser = await chromium.launch();
  for (const [file, name] of [["partner", "Jordan Ellis"], ["steward", "Lee Whitford"]] as const) {
    const page = await browser.newPage({ baseURL: config.projects[0]!.use.baseURL });
    await page.goto("sign-in");
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page.waitForURL(/\/intelligence\/?$/);
    await page.context().storageState({ path: `tests/perf/.auth/${file}.json` });
    await page.close();
  }
  await browser.close();
}
