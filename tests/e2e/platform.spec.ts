/** The platform admin (BRD 5.3, 18.3): usage without data, and audited, read-only break-glass access. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ storageState: "tests/e2e/.auth/platform.json" });

test("sees every workspace, opens read-only break-glass access with a reason, and ends it", async ({ page }) => {
  await page.goto("./");
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole("heading", { level: 1, name: "Platform" })).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  const harbor = page.getByRole("row").filter({ hasText: "Harbor Search Group" });
  await harbor.getByText("Break-glass access").click();
  await harbor.getByRole("textbox", { name: "Reason" }).fill("Support ticket 5120: check a feed configuration");
  await harbor.getByRole("combobox", { name: "For" }).selectOption("30");
  await harbor.getByRole("button", { name: "Open read-only access" }).click();

  await expect(page.getByText(/Break-glass access to Harbor Search Group, read-only, until/)).toBeVisible();
  await expect(page.getByText(/Reason: Support ticket 5120/)).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "People" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Queue" })).toHaveCount(0);
  await page.goto("./people");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add person" })).toHaveCount(0);

  await page.getByRole("button", { name: "End access now" }).click();
  await expect(page).toHaveURL(/\/platform\?notice=break_glass_ended/);
  await expect(page.getByText("Break-glass access ended.")).toBeVisible();
  await page.goto("./people");
  await expect(page).toHaveURL(/\/platform$/);
});

test("fits at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("./platform");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
