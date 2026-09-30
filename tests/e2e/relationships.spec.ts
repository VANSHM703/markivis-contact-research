/** Relationships in the browser (BRD 11.4 to 11.8): score block, paths, coverage, scoring. Demo workspace. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ storageState: "tests/e2e/.auth/partner.json" });
test.describe.configure({ mode: "serial" });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
}

test("a strong relationship shows its score, band and the five factors in words", async ({ page }) => {
  await page.goto("./people?band=strong");
  await expect(page.getByRole("columnheader", { name: "Band" })).toBeVisible();
  await page.locator("tbody a").first().click();
  const block = page.getByRole("region", { name: "Relationship" });
  await expect(block.getByText("/ 100")).toBeVisible();
  await expect(block.getByText("Strong", { exact: true })).toBeVisible();
  for (const factor of ["Recency", "Frequency", "Reciprocity", "Depth", "Tenure"]) await expect(block.locator("dt").filter({ hasText: new RegExp(`^${factor}`) })).toBeVisible();
  await expect(block.getByText(/Last two-way touch: \d+ days? ago/)).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("scenario 15 in the browser: Paths finds a one-hop path and drafts the introduction request to the connector", async ({ page }) => {
  await page.goto("./paths");
  await expect(page.getByText("Search for a person to see who can introduce you.")).toBeVisible();
  await page.getByRole("searchbox", { name: "Person" }).fill("Declan Whitcombe");
  await page.getByRole("button", { name: "Find paths" }).click();
  await page.getByRole("link", { name: "Declan Whitcombe" }).click();
  await expect(page.getByRole("heading", { name: /Paths to Declan Whitcombe/ })).toBeVisible();
  const first = page.getByRole("listitem").filter({ hasText: "Draft introduction request" }).first();
  await expect(first).toContainText(/has a (strong|warm) relationship with/);
  expect(await axe(page)).toEqual([]);
  const connector = ((await first.locator("p").first().textContent()) ?? "").split("→")[1]!.trim();
  await first.getByRole("button", { name: /Draft introduction request/ }).click();
  await expect(page.getByRole("dialog").getByText("Action created.")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("heading", { level: 2, name: connector })).toBeVisible();
  await expect(page.getByRole("dialog").getByText(`Ask ${connector} for an introduction to Declan Whitcombe`).first()).toBeVisible();
});

test("the coverage map tints seats by band and opens Add person for an empty seat", async ({ page }) => {
  await page.goto("./coverage?tier=1");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByLabel("Legend").getByText("None or not scored")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  const empty = page.getByRole("link", { name: /^No one mapped/ }).first();
  const label = (await empty.textContent()) ?? "";
  const [, seat, company] = /mapped\s*: (.+?) at (.+), add a person/.exec(label) ?? [];
  const titles: Record<string, string> = { CEO: "Chief Executive Officer", CFO: "Chief Financial Officer", CHRO: "Chief Human Resources Officer", COO: "Chief Operating Officer", "CTO or CIO": "Chief Technology Officer", Chair: "Chair", "Other board": "Independent Director" };
  await empty.click();
  await expect(page.getByRole("heading", { level: 1, name: "Add person" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Company" })).toHaveValue(company!);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(titles[seat!]!);
});

test("calibration: the partner ranks people blind and sees the rank correlation", async ({ page }) => {
  await page.goto("./settings/scoring?tab=calibration");
  const inputs = page.getByRole("spinbutton", { name: /^Rank for / });
  expect(await inputs.count()).toBeGreaterThanOrEqual(5);
  for (let k = 0; k < 6; k++) await inputs.nth(k).fill(String(k + 1));
  await page.getByRole("button", { name: "Save ranking" }).click();
  await expect(page.getByText(/Ranking saved/)).toBeVisible();
  await expect(page.getByText(/Rank correlation with the current weights: -?\d\.\d\d/)).toBeVisible();
  expect(await axe(page)).toEqual([]);
});
