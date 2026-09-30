import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("redirects to sign-in and lists the demo users in mock mode", async ({ page }) => {
    await page.goto("./people");
    await expect(page).toHaveURL(/\/intelligence\/sign-in$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Jordan Ellis/ })).toBeVisible();
  });

  test("the sign-in page passes axe and fits at 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("./sign-in");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });

  test("API routes refuse anonymous requests", async ({ request }) => {
    const response = await request.get("api/v1/people");
    expect(response.status()).toBe(401);
  });

  test("session cookies are scoped to the base path", async ({ page, context }) => {
    await page.goto("./sign-in");
    await page.getByRole("button", { name: /Lee Whitford/ }).click();
    await page.waitForURL(/\/intelligence\/?$/);
    const cookies = await context.cookies();
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies.filter((c) => c.path !== "/intelligence").map((c) => `${c.name} ${c.path}`)).toEqual([]);
  });
});

test.describe("seed workspace", () => {
  test("People lists the 150 seeded people, 50 per page", async ({ page }) => {
    await page.goto("./people");
    await expect(page.getByText("Showing 1 to 50 of 150")).toBeVisible();
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page.getByText("Showing 51 to 100 of 150")).toBeVisible();
  });

  test("Companies lists the 40 seeded companies", async ({ page }) => {
    await page.goto("./companies");
    await expect(page.getByText("Showing 1 to 40 of 40")).toBeVisible();
  });

  test("a person row opens the person with their roles", async ({ page }) => {
    await page.goto("./people");
    const first = page.getByRole("table").getByRole("link").first();
    const name = (await first.locator(".cell-title").textContent())!;
    await first.click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Roles" })).toBeVisible();
  });

  test("an outreach owner has no Queue or Settings in the navigation", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("./sign-in");
    await page.getByRole("button", { name: /Priya Raman/ }).click();
    await page.waitForURL(/\/intelligence\/?$/);
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "People" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Queue" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await page.goto("./settings");
    await expect(page.getByText(/available to partners and data stewards/)).toBeVisible();
    await context.close();
  });
});

test.describe("workspace switcher", () => {
  test.use({ storageState: "tests/e2e/.auth/validator.json" });

  test("switches between workspaces and never shows the other workspace's people", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("./people");
    await expect(page.getByText("of 150")).toBeVisible();
    const demoPersonUrl = await page.getByRole("table").getByRole("link").first().getAttribute("href");

    await page.getByRole("button", { name: /Switch workspace/ }).click();
    await page.getByRole("button", { name: /Harbor Search Group/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await expect(page.getByText("What needs you today in Harbor Search Group")).toBeVisible();

    await page.goto("./people");
    await expect(page.getByText("Showing 1 to 12 of 12")).toBeVisible();

    // A Demo person's page is not found from inside Harbor.
    const response = await page.goto(`.${demoPersonUrl!.replace(/^\/intelligence/, "")}`);
    expect(response?.status()).toBe(404);
  });

  test("the switcher moves into the navigation drawer at 360 px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("./");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog", { name: "Navigation" }).getByRole("button", { name: /Switch workspace/ })).toBeVisible();
  });
});
