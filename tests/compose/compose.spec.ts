/**
 * Acceptance scenario 24 (BRD 22.2): from a fresh clone, docker compose up gives a running app in
 * mock mode with every main screen populated and the Mock data badge showing.
 */
import { expect, test } from "@playwright/test";

test("the composed stack opens with the demo populated and the Mock data badge", async ({ page }) => {
  await page.goto("sign-in");
  await expect(page.getByText("Mock data").first()).toBeVisible();
  await page.getByRole("button", { name: /Jordan Ellis/ }).click();
  await page.waitForURL(/\/intelligence\/?$/);

  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(page.getByText("Mock data").first()).toBeVisible();

  await page.goto("people");
  await expect(page.getByText(/^Showing 1 to 50 of \d+$/)).toBeVisible();
  await page.goto("companies");
  await expect(page.getByText(/^Showing 1 to \d+ of \d+$/)).toBeVisible();
  await page.goto("queue");
  await expect(page.locator("main nav a[href*='item=']").first()).toBeVisible();
  await page.goto("signals");
  await expect(page.locator("main li.card").first()).toBeVisible();
  await page.goto("actions?owner=all&status=all");
  await expect(page.locator("[data-action-row]").first()).toBeVisible();
  await page.goto("coverage");
  await expect(page.getByRole("heading", { level: 1, name: "Coverage" })).toBeVisible();
  await page.goto("settings/email");
  await expect(page.getByText(/Your day in Demo Search Partners/).first()).toBeVisible();
});
