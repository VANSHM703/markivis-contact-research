/**
 * Acceptance scenario 25 (BRD 22.2): no serious or critical axe violations on every screen. The
 * fixed routes are in shell.spec.ts; this covers the screens behind an id, found at run time:
 * each tab of a person, a company, the record forms, and an open queue item.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function serious(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
}

async function firstHref(page: Page, list: string, pattern: RegExp): Promise<string> {
  await page.goto(`./${list}`);
  const hrefs = await page.locator("main a[href]").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  const href = hrefs.find((h) => pattern.test(h));
  expect(href, `a link matching ${pattern} on /${list}`).toBeDefined();
  return href!.replace(/^\/intelligence\//, "");
}

test("every tab of a person page, and the forms behind it", async ({ page }) => {
  const person = await firstHref(page, "people?flag=placed", /\/people\/[0-9a-f-]{36}$/);
  for (const suffix of ["", "?tab=interactions", "?tab=connections", "?tab=brief", "?tab=record", "?tab=notes", "/edit", "/roles/new", "/interactions/new", "/actions/new", "/merge", "/placements/new"]) {
    await page.goto(`./${person}${suffix}`);
    await expect(page.locator("h1").first()).toBeVisible();
    expect(await serious(page), `/${person}${suffix}`).toEqual([]);
  }
});

test("a company page and its edit form", async ({ page }) => {
  const company = await firstHref(page, "companies", /\/companies\/[0-9a-f-]{36}$/);
  for (const suffix of ["", "/edit"]) {
    await page.goto(`./${company}${suffix}`);
    await expect(page.locator("h1").first()).toBeVisible();
    expect(await serious(page), `/${company}${suffix}`).toEqual([]);
  }
});

test("an open queue item in each lane", async ({ page }) => {
  for (const tab of ["review", "research", "parked", "spot"]) {
    await page.goto(`./queue?tab=${tab}`);
    const item = page.locator("main nav a[href*='item=']").first();
    if (await item.count()) await item.click();
    expect(await serious(page), `/queue?tab=${tab}`).toEqual([]);
  }
});

test.describe("as the validator", () => {
  test.use({ storageState: "tests/e2e/.auth/validator.json" });
  test("the shadow run tab, which only validators and platform admins see", async ({ page }) => {
    await page.goto("./queue?tab=shadow");
    await expect(page.getByRole("heading", { name: "Shadow run" })).toBeVisible();
    expect(await serious(page)).toEqual([]);
  });
});

test("the partner does not see the shadow run tab", async ({ page }) => {
  await page.goto("./queue?tab=shadow");
  await expect(page.getByRole("heading", { name: "Shadow run" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Shadow/ })).toHaveCount(0);
});
