/** Settings, Sources (M3): health checks, runs, feeds, the Apollo key and newsletter uploads. Harbor only. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ storageState: "tests/e2e/.auth/harbor.json" });
test.describe.configure({ mode: "serial" });

test("lists every source with its health, and passes axe", async ({ page }) => {
  await page.goto("./settings/sources");
  await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
  for (const name of ["SEC EDGAR 8-K Item 5.02", "Appointments wire (demo)", "Google Alerts: tracked executives", "Leadership and board pages", "Newsletter events (CSV)", "Apollo enrichment"]) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("checks a connection and shows the result inline", async ({ page }) => {
  await page.goto("./settings/sources");
  await page.getByRole("button", { name: "Check connection: SEC EDGAR 8-K Item 5.02" }).click();
  await expect(page.getByText(/EDGAR reachable/)).toBeVisible();
});

test("queues a run", async ({ page }) => {
  await page.goto("./settings/sources");
  await page.getByRole("listitem").filter({ hasText: "Appointments wire (demo)" }).getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText(/Run queued/)).toBeVisible();
});

test("adds a Google Alerts feed, and asks wires for their terms", async ({ page }) => {
  await page.goto("./settings/sources");
  const form = page.getByRole("region", { name: "Add a feed" }).or(page.locator("section", { has: page.getByRole("heading", { name: "Add a feed" }) }));
  await form.getByLabel("Type").selectOption("press_wire");
  await form.getByLabel("Name").fill("Second wire");
  await form.getByLabel("Feed addresses").fill("https://wire.example.net/rss/other");
  await form.getByRole("button", { name: "Add feed" }).click();
  await expect(page.getByText("Wire feeds need the link to their terms")).toBeVisible();

  await form.getByLabel("Type").selectOption("google_alert");
  await form.getByLabel("Name").fill("Alerts: board members");
  await form.getByLabel("Feed addresses").fill("https://alerts.example.net/feeds/board-members");
  await form.getByRole("button", { name: "Add feed" }).click();
  await expect(page.getByText("Feed added.")).toBeVisible();
  await expect(page.getByText("Alerts: board members", { exact: true })).toBeVisible();
});

test("saves an Apollo key without ever showing it again", async ({ page }) => {
  await page.goto("./settings/sources");
  await page.getByLabel("Apollo API key").fill("e2e-test-key-0000000000");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText(/Apollo key saved/)).toBeVisible();
  await expect(page.getByText(/A key is saved/)).toBeVisible();
  expect(await page.content()).not.toContain("e2e-test-key-0000000000");
});

test("uploads newsletter events and reports what happened", async ({ page }) => {
  await page.goto("./settings/sources");
  const csv = "email,event,occurred_at,issue_title,link_url,topics\nreader@unrelated.example.net,click,2026-09-20T10:00:00Z,Issue,,CFO agenda\nnot-an-email,click,2026-09-20T10:00:00Z,,,\n";
  await page.getByLabel("Events file").setInputFiles({ name: "events.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Upload events" }).click();
  await expect(page.getByText(/1 events read: 1 new, 0 already imported, 1 rows rejected/)).toBeVisible();
});

test("switches a source off and on", async ({ page }) => {
  await page.goto("./settings/sources");
  const row = page.getByRole("listitem").filter({ hasText: "Leadership and board pages" });
  await row.getByRole("button", { name: "Switch off" }).click();
  await expect(page.getByText(/Source switched off/)).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "Leadership and board pages" }).getByRole("button", { name: "Switch on" }).click();
  await expect(page.getByText("Source switched on.")).toBeVisible();
});
