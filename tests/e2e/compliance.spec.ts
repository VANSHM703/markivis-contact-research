/**
 * Compliance in the browser (BRD 18), as the data steward: consent, do not contact, the access
 * export, erasure, the suppression list, the retention review, members and the audit log.
 * Demo workspace. Each test works on its own person, so they can run in parallel.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ storageState: "tests/e2e/.auth/steward.json" });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
}

/** A retention review candidate staged by the demo: their page, on the Consent and privacy tab. */
async function openFormer(page: Page, name: string) {
  await page.goto("./settings/retention");
  await page.getByRole("link", { name, exact: true }).click();
  await page.getByRole("link", { name: "Consent and privacy" }).click();
  await expect(page.getByRole("heading", { name: "Data subject requests" })).toBeVisible();
}

const STEWARD_ROUTES = ["settings", "settings/consent", "settings/retention", "settings/export", "settings/members", "settings/audit", "settings/content", "settings/priorities"];

test.describe("steward screens", () => {
  for (const route of STEWARD_ROUTES) {
    test(`/${route} passes axe and fits at 320 px`, async ({ page }) => {
      await page.goto(`./${route}`);
      expect(await axe(page)).toEqual([]);
      for (const width of [320, 768]) {
        await page.setViewportSize({ width, height: 800 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `/${route} at ${width} px`).toBeLessThanOrEqual(0);
      }
    });
  }
});

test("records consent and sets do not contact from a person's page", async ({ page }) => {
  await openFormer(page, "Marguerite Sandvik");
  expect(await axe(page)).toEqual([]);
  await page.locator("summary", { hasText: "Record consent" }).click();
  await page.getByRole("combobox", { name: "Status" }).selectOption("opted_out");
  await page.getByRole("textbox", { name: "Proof" }).fill("Asked by phone not to be contacted, 30 Sep 2026");
  await page.getByRole("button", { name: "Record consent" }).click();
  await expect(page.getByText("Consent recorded.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Opted out (US)" })).toBeVisible();

  await page.getByRole("button", { name: "Mark do not contact" }).click();
  await expect(page.getByText("Marked do not contact.")).toBeVisible();
  await expect(page.getByText("Do not contact", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Suppressed: Do not contact")).toBeVisible();
  await page.getByRole("button", { name: "Clear do not contact" }).click();
  await expect(page.getByText("Do not contact cleared.")).toBeVisible();
});

test("erasure needs the full name typed back, then removes the person for good", async ({ page }) => {
  await openFormer(page, "Tobias Wrenfield");
  const url = page.url();
  await page.locator("summary", { hasText: "Erase this person" }).click();
  await page.getByRole("textbox", { name: /To confirm, type their full name/ }).fill("Tobias");
  await page.getByRole("button", { name: "Erase permanently" }).click();
  await expect(page.getByText("Couldn't erase: type the person's full name exactly as shown to confirm.")).toBeVisible();

  const details = page.locator("details", { has: page.locator("summary", { hasText: "Erase this person" }) });
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) await details.locator("summary").click();
  await page.getByRole("textbox", { name: /To confirm, type their full name/ }).fill("Tobias Wrenfield");
  await page.getByRole("button", { name: "Erase permanently" }).click();
  await expect(page).toHaveURL(/\/people\?notice=person_erased/);
  await expect(page.getByText(/Erased\. Everything held about this person was deleted/)).toBeVisible();

  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Tobias Wrenfield" })).toHaveCount(0);
  await page.goto("./settings/audit?action=person.");
  await expect(page.getByText("person.erased", { exact: true }).first()).toBeVisible();
  await page.goto("./settings/consent");
  await page.getByRole("textbox", { name: "Email address or LinkedIn profile URL" }).first().fill("https://www.linkedin.com/in/example-tobias-wrenfield");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText(/This profile is suppressed: erasure/)).toBeVisible();
});

test("the access export downloads a ZIP for one person", async ({ page }) => {
  await openFormer(page, "Ignatius Pell");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export everything held" }).click();
  expect((await download).suggestedFilename()).toMatch(/^person-[0-9a-f]{8}-export-\d{4}-\d{2}-\d{2}\.zip$/);
});

test("adds an address to the suppression list and finds it again", async ({ page }) => {
  await page.goto("./settings/consent");
  const add = page.locator("form").filter({ has: page.getByRole("button", { name: "Add to the list" }) });
  await add.getByRole("textbox").fill("phoned.in.e2e@example.com");
  await add.getByRole("combobox", { name: "Reason" }).selectOption("do_not_contact");
  await page.getByRole("button", { name: "Add to the list" }).click();
  await expect(page.getByText("Added to the suppression list.")).toBeVisible();
  await page.getByRole("textbox", { name: "Email address or LinkedIn profile URL" }).first().fill("PHONED.IN.E2E@example.com");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText(/This address is suppressed: do not contact/)).toBeVisible();
  // The address is posted, never put in the address bar.
  expect(page.url()).not.toContain("phoned");
});

test("the workspace export downloads every table", async ({ page }) => {
  await page.goto("./settings/export");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download the workspace" }).click();
  expect((await download).suggestedFilename()).toMatch(/^demo-search-partners-export-\d{4}-\d{2}-\d{2}\.zip$/);
});

test("keeps a person in the retention review", async ({ page }) => {
  await page.goto("./settings/retention");
  const row = page.getByRole("row").filter({ hasText: "Harriet Vossberg" });
  await row.getByRole("button", { name: "Keep" }).click();
  await expect(page.getByText("Kept. They leave the retention review for 12 months.")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Harriet Vossberg" })).toHaveCount(0);
});

test("invites a member and changes their role", async ({ page }) => {
  await page.goto("./settings/members");
  await page.getByRole("textbox", { name: "Work email" }).fill("new.associate@demo-search.example.com");
  await page.getByRole("radio", { name: /Validator/ }).check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation sent. They join the workspace when they first sign in.")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "new.associate@demo-search.example.com" });
  await expect(row.getByText("Invited")).toBeVisible();
  await row.getByRole("combobox").selectOption("account_lead");
  await row.getByRole("button", { name: "Change" }).click();
  await expect(page.getByText("Role changed.")).toBeVisible();
  // The only partner cannot be demoted.
  const partner = page.getByRole("row").filter({ hasText: "Jordan Ellis" });
  await partner.getByRole("combobox").selectOption("validator");
  await partner.getByRole("button", { name: "Change" }).click();
  await expect(page.getByText("A workspace needs at least one partner. Make someone else a partner first.")).toBeVisible();
});
