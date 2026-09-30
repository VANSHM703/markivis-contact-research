import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ROUTES = ["", "actions", "queue", "queue?tab=conflicts", "people", "people/new", "people/import", "companies", "companies/new", "search?q=example", "signals", "paths", "coverage", "settings", "settings/sources"];

// BEAM_DESIGN_LANGUAGE.md section 2.4: zero horizontal scroll at these widths.
const WIDTHS = [320, 360, 390, 414, 768, 1024, 1440];

test.describe("app shell", () => {
  for (const width of [360, 1440]) {
    test(`renders the brand lockup and navigation at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("./");
      await expect(page.getByRole("link", { name: "BEAM by Markivis home" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
      await expect(page.getByText("Mock data")).toBeVisible();

      if (width < 960) {
        await page.getByRole("button", { name: "Open navigation" }).click();
        const drawer = page.getByRole("dialog", { name: "Navigation" });
        await expect(drawer.getByRole("link", { name: "People" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(drawer).toBeHidden();
      } else {
        await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "People" })).toBeVisible();
      }
    });
  }

  for (const width of WIDTHS) {
    test(`has no horizontal page scroll at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const route of [...ROUTES, "people?page=2"]) {
        await page.goto(`./${route}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `/${route} at ${width} px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test("navigates between sections and marks the active item", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("./");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByRole("link", { name: "Companies" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Companies" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Companies" })).toHaveAttribute("aria-current", "page");
  });

  test("focuses search with the / key", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("./");
    await page.keyboard.press("/");
    await expect(page.getByRole("searchbox", { name: "Search people and companies" })).toBeFocused();
  });

  for (const route of ROUTES) {
    test(`has no serious or critical axe violations on /${route}`, async ({ page }) => {
      await page.goto(`./${route}`);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  }
});
