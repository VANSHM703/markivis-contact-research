/**
 * The executive search pack in the browser (BRD 13): on in Demo Search Partners, off in Harbor
 * Search Group, and switched on and off by a platform admin (M6: the pack toggles cleanly).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
}

async function openPerson(page: Page, name: string) {
  await page.goto(`./people?q=${encodeURIComponent(name)}`);
  await page.getByRole("link", { name }).first().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test.describe("pack on, as the partner", () => {
  test.use({ storageState: "tests/e2e/.auth/partner.json" });

  test("people show contact types, placed and off-limits flags; an off-limits executive carries the badge", async ({ page }) => {
    await page.goto("./people?flag=off_limits");
    await expect(page.getByRole("columnheader", { name: "Contact type" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Import placements" })).toBeVisible();
    await expect(page.getByText("Zoltan Sandoval")).toBeVisible();
    await openPerson(page, "Zoltan Sandoval");
    await expect(page.getByText("Off-limits", { exact: true }).first()).toBeVisible();
  });

  test("adds an off-limits rule from the company picker and ends it", async ({ page }) => {
    await page.goto("./settings/off-limits");
    expect(await axe(page)).toEqual([]);
    const company = page.getByRole("combobox", { name: "Company" });
    await company.fill("Caldrith");
    await page.getByRole("option", { name: /Caldrith Health/ }).click();
    await page.getByRole("combobox", { name: "Covers" }).selectOption("function");
    await page.getByRole("textbox", { name: "Function" }).fill("Operations");
    await page.getByRole("combobox", { name: "Reason" }).selectOption("contractual");
    await page.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByText("Off-limits rule added.")).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Caldrith Health" }).filter({ hasText: "Operations function" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /End today|Remove/ }).click();
    await expect(page.getByText("Off-limits rule ended.")).toBeVisible();
  });

  test("writes a confidential mandate note, visible on the Notes tab", async ({ page }) => {
    await openPerson(page, "Zoltan Sandoval");
    await page.getByRole("link", { name: "Notes" }).click();
    await expect(page.getByRole("heading", { name: "Confidential mandate notes" })).toBeVisible();
    await page.getByRole("textbox", { name: "New note" }).fill("Discussed a possible COO search at a portfolio company; keep this between us.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Note added. Only partners can read it.")).toBeVisible();
    await expect(page.getByText("Discussed a possible COO search")).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test("records a placement by hand", async ({ page }) => {
    await openPerson(page, "Zoltan Sandoval");
    await page.getByRole("link", { name: "Record placement" }).click();
    await page.getByRole("textbox", { name: "Placement date" }).fill("2022-06-01");
    await page.getByRole("button", { name: "Record placement" }).click();
    await expect(page.getByText(/Placement recorded/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Placements" })).toBeVisible();
  });
});

test.describe("pack on, as the outreach owner", () => {
  test.use({ storageState: "tests/e2e/.auth/outreach.json" });

  test("sees no confidential notes and cannot open the off-limits screen", async ({ page }) => {
    await openPerson(page, "Zoltan Sandoval");
    await expect(page.getByRole("link", { name: "Notes" })).toHaveCount(0);
    await page.goto("./people/" + page.url().split("/people/")[1]!.split("?")[0] + "?tab=notes");
    await expect(page.getByRole("heading", { name: "Confidential mandate notes" })).toHaveCount(0);
    await page.goto("./settings/off-limits");
    await expect(page.getByText(/This screen is available to partners\./)).toBeVisible();
  });
});

async function harborPeopleHasContactTypes(browser: Browser): Promise<boolean> {
  const context = await browser.newContext({ storageState: "tests/e2e/.auth/harbor.json" });
  const page = await context.newPage();
  await page.goto("./people");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  const shown = (await page.getByRole("columnheader", { name: "Contact type" }).count()) > 0;
  await context.close();
  return shown;
}

test.describe("pack off, as the Harbor partner", () => {
  test.use({ storageState: "tests/e2e/.auth/harbor.json" });

  test("hides every pack element", async ({ page }) => {
    await page.goto("./people");
    await expect(page.getByRole("columnheader", { name: "Contact type" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Import placements" })).toHaveCount(0);
    await page.locator("tbody a").first().click();
    await expect(page.getByRole("link", { name: "Notes" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Record placement" })).toHaveCount(0);
    await page.getByRole("link", { name: "Edit details" }).click();
    await expect(page.getByRole("group", { name: "Contact type" })).toHaveCount(0);
    expect((await page.goto("./settings/off-limits"))?.status()).toBe(404);
    expect((await page.goto("./people/placements/import"))?.status()).toBe(404);
    await page.goto("./settings");
    await expect(page.getByRole("link", { name: /Off-limits rules/ })).toHaveCount(0);
  });
});

test.describe("a platform admin switches the pack", () => {
  test.use({ storageState: "tests/e2e/.auth/validator.json" });

  test("on and off for Harbor Search Group; the partner's screens follow", async ({ page, browser }) => {
    await page.goto("./");
    await page.getByRole("button", { name: /Switch workspace/ }).click();
    await page.getByRole("button", { name: /Harbor Search Group/ }).click();
    await expect(page.getByText("What needs you today in Harbor Search Group")).toBeVisible();
    await page.getByRole("button", { name: /Account: Sam Okafor/ }).click();
    await page.getByRole("link", { name: "Workspace packs" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Packs" })).toBeVisible();
    expect(await axe(page)).toEqual([]);

    const exec = page.getByRole("checkbox", { name: /Executive search/ });
    await expect(exec).not.toBeChecked();
    await exec.check();
    await page.getByRole("button", { name: "Save packs" }).click();
    await expect(page.getByText("Packs saved.")).toBeVisible();
    expect(await harborPeopleHasContactTypes(browser)).toBe(true);

    await page.getByRole("checkbox", { name: /Executive search/ }).uncheck();
    await page.getByRole("button", { name: "Save packs" }).click();
    await expect(page.getByText("Packs saved.")).toBeVisible();
    expect(await harborPeopleHasContactTypes(browser)).toBe(false);
  });

  test("anyone else is refused", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "tests/e2e/.auth/partner.json" });
    const page = await context.newPage();
    await page.goto("./settings/packs");
    await expect(page.getByText(/This screen is available to platform admins\./)).toBeVisible();
    await context.close();
  });
});
