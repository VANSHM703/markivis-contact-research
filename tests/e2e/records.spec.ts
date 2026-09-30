/**
 * M2 flows end to end: manual entry, the duplicate check, CSV import with preview, the
 * possible-duplicate queue item, ending a role, and merge with unmerge.
 * Runs as the Harbor partner and changes only Harbor, so Demo's seed counts stay fixed.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ storageState: "tests/e2e/.auth/harbor.json" });
test.describe.configure({ mode: "serial" });

const PERSON = "Oriel Vantasse";

async function chooseCompany(page: Page, query: string, name = "Tarnwick Cable") {
  const picker = page.getByRole("combobox", { name: "Company" });
  await picker.fill(query);
  await page.getByRole("option", { name: new RegExp(name) }).click();
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
}

test("adds a person by hand, with a source note", async ({ page }) => {
  await page.goto("./people/new");
  await page.getByRole("button", { name: "Add person" }).click();
  const summary = page.getByRole("alert").filter({ hasText: "Check these fields" });
  await expect(summary).toContainText("full name");
  await expect(summary).toContainText("title");
  await expect(summary).toContainText("company");
  await expect(summary).toContainText("note");

  await page.getByLabel("Full name").fill(PERSON);
  await page.getByLabel("City").fill("Portland");
  await page.getByLabel("Prospective client").check();
  await chooseCompany(page, "Tarnwick");
  await expect(page.getByText("Existing company")).toBeVisible();
  await page.getByLabel("Title").fill("Chief Operating Officer");
  await page.getByLabel("Note").fill("Named in the company's leadership update");
  await page.getByRole("button", { name: "Add person" }).click();

  await expect(page.getByText("Person added.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: PERSON })).toBeVisible();
  await expect(page.getByText("Chief Operating Officer, Tarnwick Cable").first()).toBeVisible();
  await page.getByRole("link", { name: "Record" }).click();
  await expect(page.getByText("Named in the company's leadership update").first()).toBeVisible();
});

test("adding the same person again finds the existing record instead", async ({ page }) => {
  await page.goto("./people/new");
  await page.getByLabel("Full name").fill(PERSON);
  await chooseCompany(page, "Tarnwick");
  await page.getByLabel("Title").fill("COO");
  await page.getByLabel("Note").fill("Second attempt");
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "already in the workspace" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open their record" })).toBeVisible();
});

test("imports a CSV: preview first, then a report; a same-name, same-city row goes to the queue", async ({ page }) => {
  await page.goto("./people/import");
  expect(await axe(page)).toEqual([]);
  const csv = [
    "company_name,company_domain,person_full_name,person_title,person_email,person_city",
    `Brightwater Example Co,brightwater.example.org,${PERSON},Advisor,,Portland`,
    "Tarnwick Cable,,Kestrel Imbery,Chief Financial Officer,kestrel@tarnwick.example.org,Denver",
    "Tarnwick Cable,,Broken Row,CEO,not-an-email,",
  ].join("\n");
  await page.getByLabel("Target list").setInputFiles({ name: "harbor-targets.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByLabel("Note").fill("Harbor target list, e2e");
  await page.getByRole("button", { name: "Preview import" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Check the import" })).toBeVisible();
  await expect(page.getByText("Possible duplicate: goes to the queue")).toBeVisible();
  await expect(page.getByText("person_email", { exact: false }).first()).toBeVisible();
  expect(await axe(page)).toEqual([]);

  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Import complete" })).toBeVisible();
  const band = page.getByRole("region", { name: "Import result" });
  await expect(band.getByText("People created")).toBeVisible();
  await expect(page.getByText("Row 4")).toBeVisible();
  await expect(page.getByText(/items are waiting for a validator/)).toBeVisible();
});

test("the possible duplicate can be kept separate from the queue", async ({ page }) => {
  await page.goto("./queue?tab=conflicts");
  await expect(page.getByRole("heading", { name: "Possible duplicate" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole("button", { name: "Keep separate" }).first().click();
  await expect(page.getByText("Kept as separate people.")).toBeVisible();
});

test("ends a role and keeps the person", async ({ page }) => {
  await page.goto("./people?q=Kestrel");
  await page.getByRole("link", { name: /Kestrel Imbery/ }).click();
  await page.getByText("End role").first().click();
  await page.getByLabel("How do you know?").fill("Left in September");
  await page.getByRole("button", { name: "End role" }).click();
  await expect(page.getByText("Role ended.")).toBeVisible();
  await expect(page.getByText("No current role").first()).toBeVisible();
});

test("merges two records and reverses the merge from the hidden record", async ({ page }) => {
  await page.goto(`./people?q=${encodeURIComponent(PERSON)}`);
  await expect(page.getByText("2 people match these filters.")).toBeVisible();
  await page.getByRole("table").getByRole("link").first().click();
  await page.waitForURL(/\/people\/[0-9a-f-]{36}$/);
  const survivorPath = new URL(page.url()).pathname;
  await page.getByRole("link", { name: "Merge" }).click();
  await page.getByRole("button", { name: "Search" }).click();
  const compare = page.getByRole("link", { name: /Compare/ }).first();
  const mergedId = new URL((await compare.getAttribute("href"))!, page.url()).searchParams.get("other")!;
  await compare.click();
  await expect(page.getByRole("heading", { name: "Check before you merge" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole("button", { name: /^Merge .* into / }).click();
  await expect(page.getByText(/Records merged/)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(survivorPath);

  await page.goto(`./people?q=${encodeURIComponent(PERSON)}`);
  await expect(page.getByText("1 people match these filters.")).toBeVisible();

  await page.goto(`./people/${mergedId}`);
  await expect(page.getByText(/This record was merged into/)).toBeVisible();
  await page.getByRole("button", { name: "Reverse merge" }).click();
  await expect(page.getByText("Merge reversed.")).toBeVisible();
  await page.goto(`./people?q=${encodeURIComponent(PERSON)}`);
  await expect(page.getByText("2 people match these filters.")).toBeVisible();
});
