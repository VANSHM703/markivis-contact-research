/** The validation queue (BRD 10, design file 9.5), worked with the keyboard as a validator. Demo workspace. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ storageState: "tests/e2e/.auth/validator.json" });
test.describe.configure({ mode: "serial" });

async function axe(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
}

async function count(page: import("@playwright/test").Page, label: string) {
  const text = (await page.getByRole("link", { name: new RegExp(`^${label}`) }).textContent()) ?? "";
  return Number(/\((\d+)\)/.exec(text)?.[1] ?? 0);
}

test("shows review items with the detail pane, and passes axe", async ({ page }) => {
  await page.goto("./queue");
  await expect(page.getByRole("heading", { level: 1, name: "Queue" })).toBeVisible();
  expect(await count(page, "Review")).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Confirm change" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Sources \(\d+\)/ })).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("scenario 7 by keyboard: r then 1 rejects the item as wrong person and moves on", async ({ page }) => {
  await page.goto("./queue");
  const before = await count(page, "Review");
  const headline = await page.getByRole("heading", { level: 2 }).first().textContent();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("r");
  await expect(page.getByRole("button", { name: /Wrong person/ })).toBeFocused();
  await page.keyboard.press("1");
  await expect(page.getByText("Rejected: wrong person.")).toBeVisible();
  expect(await count(page, "Review")).toBe(before - 1);
  await expect(page.getByRole("heading", { level: 2, name: headline! })).toHaveCount(0);
});

test("shortcuts do not fire while typing in a field", async ({ page }) => {
  await page.goto("./queue");
  const before = await count(page, "Review");
  await page.keyboard.press("e");
  const headlineField = page.getByLabel("Headline");
  await expect(headlineField).toBeFocused();
  await headlineField.press("End");
  await page.keyboard.type(" c r p");
  expect(await count(page, "Review")).toBe(before);
});

test("c confirms with the edited headline", async ({ page }) => {
  await page.goto("./queue");
  const before = await count(page, "Review");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("e");
  await page.getByLabel("Headline").fill("Edited in the e2e test");
  await page.getByLabel("Headline").blur();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("c");
  await expect(page.getByText("Change confirmed.")).toBeVisible();
  expect(await count(page, "Review")).toBe(before - 1);
  await page.goto("./signals");
  await expect(page.getByText("Edited in the e2e test")).toBeVisible();
});

test("more research runs, then the button is disabled after two cycles", async ({ page }) => {
  await page.goto("./queue");
  // Track the item by its ID: several headlines can start the same way.
  const href = (await page.getByRole("navigation", { name: "Items" }).locator('a[aria-current="true"]').getAttribute("href"))!;
  const itemPath = `./queue?${href.split("?")[1]}`;
  for (let i = 0; i < 2; i++) {
    await page.goto(itemPath);
    await page.getByRole("button", { name: "More research" }).click();
    await expect(page.getByText(/Research finished/)).toBeVisible();
  }
  await page.goto(itemPath);
  await expect(page.getByRole("button", { name: "More research" })).toBeDisabled();
  await expect(page.getByText("Research used: confirm, reject or park.")).toBeVisible();
  await expect(page.getByText("2 of 2 cycles")).toBeVisible();
});

test("scenario 9 in the interface: approving the batch with one unticked leaves that one", async ({ page }) => {
  await page.goto("./queue?tab=batch");
  const before = await count(page, "Weekly batch");
  expect(before).toBeGreaterThan(1);
  expect(await axe(page)).toEqual([]);
  await page.getByRole("checkbox").first().uncheck();
  await page.getByRole("button", { name: "Approve ticked items" }).click();
  await expect(page.getByText("Batch approved.")).toBeVisible();
  expect(await count(page, "Weekly batch")).toBe(1);
});

test("the Signals screen lists confirmed changes and passes axe", async ({ page }) => {
  await page.goto("./signals");
  await expect(page.getByText(/confirmed changes in the last 30 days/)).toBeVisible();
  await expect(page.getByText("AUTO", { exact: false }).first()).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("below 760 px the list is the screen, and an item opens full screen with a way back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("./queue");
  await expect(page.getByRole("button", { name: "Confirm change" })).toBeHidden();
  await page.getByRole("navigation", { name: "Items" }).getByRole("link").first().click();
  await expect(page.getByRole("button", { name: "Confirm change" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Items" })).toBeHidden();
  await page.getByRole("link", { name: "Back to the list" }).click();
  await expect(page.getByRole("navigation", { name: "Items" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
