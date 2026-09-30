/** Activity capture in the browser (BRD 11): connect a demo mailbox, privacy, logging. Demo workspace. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
}

async function openInteractions(page: Page, name: string) {
  await page.goto(`./people?q=${encodeURIComponent(name)}`);
  await page.getByRole("link", { name }).first().click();
  await page.getByRole("link", { name: "Interactions" }).click();
  await expect(page.getByRole("heading", { name: /^Interactions/ })).toBeVisible();
}

test.describe("as the outreach owner", () => {
  test.use({ storageState: "tests/e2e/.auth/outreach.json" });

  test("connects the demo mailbox from the user menu and adds an exclusion", async ({ page }) => {
    await page.goto("./");
    await page.getByRole("button", { name: /Account: Priya Raman/ }).click();
    await page.getByRole("link", { name: "Mailbox and calendar" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Mailbox and calendar" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.getByRole("button", { name: "Connect demo Microsoft 365 mailbox" }).click();
    await expect(page.getByText(/Mailbox connected/)).toBeVisible();
    await expect(page.getByText("✓ Connected")).toBeVisible();
    await page.getByRole("textbox", { name: "Address or domain" }).fill("family.example.net");
    await page.getByRole("button", { name: "Add exclusion" }).click();
    await expect(page.getByText(/Exclusion added/)).toBeVisible();
    await expect(page.getByText("family.example.net")).toBeVisible();
  });
});

test.describe("privacy", () => {
  test("scenario 12: the partner marks a thread private; the outreach owner sees the interaction but not its subject", async ({ browser }) => {
    const partner = await (await browser.newContext({ storageState: "tests/e2e/.auth/partner.json" })).newPage();
    await openInteractions(partner, "Mairead Lacroix");
    const item = partner.getByRole("listitem").filter({ hasText: "Re: Board dinner next month" });
    await expect(item).toBeVisible();
    const before = await partner.getByRole("heading", { name: /^Interactions/ }).textContent();
    await item.getByRole("button", { name: "Mark thread private" }).click();
    await expect(partner.getByText(/Thread marked private/)).toBeVisible();
    await expect(partner.getByRole("listitem").filter({ hasText: "Re: Board dinner next month" }).getByText("Private", { exact: true })).toBeVisible();
    expect(await axe(partner)).toEqual([]);

    const outreach = await (await browser.newContext({ storageState: "tests/e2e/.auth/outreach.json" })).newPage();
    await openInteractions(outreach, "Mairead Lacroix");
    await expect(outreach.getByRole("heading", { name: /^Interactions/ })).toHaveText(before!);
    await expect(outreach.getByText("Re: Board dinner next month")).toHaveCount(0);
    await expect(outreach.getByText("Details are private.").first()).toBeVisible();
    await expect(outreach.getByRole("button", { name: /Mark thread private|Make thread visible/ })).toHaveCount(0);

    const validator = await (await browser.newContext({ storageState: "tests/e2e/.auth/validator.json" })).newPage();
    await openInteractions(validator, "Mairead Lacroix");
    await expect(validator.getByText("Re: Board dinner next month")).toHaveCount(0);
  });
});

test.describe("as the partner", () => {
  test.use({ storageState: "tests/e2e/.auth/partner.json" });

  test("logs a call by hand", async ({ page }) => {
    await page.goto("./people?q=Mairead%20Lacroix");
    await page.getByRole("link", { name: "Mairead Lacroix" }).first().click();
    await page.getByRole("link", { name: "Log interaction" }).click();
    await page.getByRole("combobox", { name: "How" }).selectOption("call");
    await page.getByRole("textbox", { name: /Summary/ }).fill("Discussed the board's timetable for the CFO search.");
    await page.getByRole("button", { name: "Log interaction" }).click();
    await expect(page.getByText("Interaction logged.")).toBeVisible();
    await expect(page.getByText("Discussed the board's timetable for the CFO search.")).toBeVisible();
  });
});
