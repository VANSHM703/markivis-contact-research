/** Outputs in the browser (BRD 12.5 to 12.7, 15): briefs, detected outcomes, sending and CRM settings. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ storageState: "tests/e2e/.auth/partner.json" });
test.describe.configure({ mode: "serial" });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
}

const HEADINGS = ["Who they are", "What changed recently", "Our history", "What they care about", "Mutual connections", "Open items", "Suggested talking points"];

test("a meeting brief opens from Today with all seven headings, and a new one can be prepared", async ({ page }) => {
  await page.goto("./");
  const meetings = page.getByRole("region", { name: "Meetings in the next 24 hours" });
  const brief = meetings.getByRole("link").filter({ hasText: "Brief ready" }).first();
  if ((await brief.count()) === 0) {
    // Seeded meetings may sit just outside the 24-hour window at this hour; open one from its person instead.
    await page.goto("./people?band=strong");
    await page.locator("tbody a").first().click();
    await page.getByRole("link", { name: "Brief", exact: true }).click();
  } else await brief.click();
  const card = page.getByRole("region", { name: "Meeting brief" });
  await card.getByRole("button", { name: /Prepare (a new )?brief/ }).click();
  await expect(page.getByText("Brief ready.")).toBeVisible();
  for (const h of HEADINGS) await expect(page.getByRole("region", { name: "Meeting brief" }).getByRole("heading", { name: h, exact: true })).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("a reply detected by mail capture shows as the sent action's outcome", async ({ page }) => {
  await page.goto("./actions?owner=all&status=sent");
  const card = page.locator("[data-action-row]").first();
  await card.click();
  await expect(page.getByRole("dialog").getByRole("list", { name: "Status" })).toContainText("Outcome: Replied");
  await expect(page.getByRole("dialog").getByRole("combobox", { name: "What happened" })).toHaveValue("replied");
});

test("the partner allows sending from the demo mailbox", async ({ page }) => {
  await page.goto("./settings/connections");
  const allow = page.getByRole("button", { name: "Allow sending" });
  if (await allow.count()) {
    await allow.click();
    await expect(page.getByText(/Sending allowed/)).toBeVisible();
  }
  await expect(page.getByText("✓ Allowed")).toBeVisible();
});

test("the CRM settings page explains the HubSpot sync and passes axe", async ({ page }) => {
  await page.goto("./settings/crm");
  await expect(page.getByRole("heading", { level: 1, name: "CRM" })).toBeVisible();
  await expect(page.getByText("A platform admin switches HubSpot sync on, on Settings, Packs.")).toBeVisible();
  expect(await axe(page)).toEqual([]);
});
