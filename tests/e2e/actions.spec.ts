/**
 * The action flow in the browser (BRD 12, design file 9.6), demo workspace, mock mode: the drawer,
 * a keyboard-only submit and approve-and-send (BRD 22.1), scenario 16 (off-limits) and scenario 17
 * (EU consent). Global setup stages one action in each state (src/db/seed/demo-actions.ts).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
}

const drawer = (page: Page) => page.getByRole("dialog");

test.describe("as the partner", () => {
  test.use({ storageState: "tests/e2e/.auth/partner.json" });

  test("the drawer opens from a card, traps focus, closes on Escape and returns focus to the card; axe passes with it open", async ({ page }) => {
    await page.goto("./actions?owner=all");
    const card = page.locator("[data-action-row]").first();
    await card.click();
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).getByRole("heading", { level: 2 })).toBeFocused();
    await expect(drawer(page).getByRole("list", { name: "Status" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    // Tab never leaves the drawer.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toHaveCount(0);
    await expect(card).toBeFocused();
  });

  test("scenario 16: a candidate approach at an off-limits client is refused; a client check-in is created and drafted", async ({ page }) => {
    await page.goto("./people?q=Zoltan%20Sandoval");
    await page.getByRole("link", { name: "Zoltan Sandoval" }).first().click();
    await page.getByRole("link", { name: "Create action" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Create an action for Zoltan Sandoval/ })).toBeVisible();
    await page.getByRole("combobox", { name: "Action", exact: true }).selectOption("invite_interview");
    await page.getByRole("combobox", { name: /^Approach/ }).selectOption("candidate");
    await page.getByRole("button", { name: "Create action" }).click();
    await expect(page.getByText(/Couldn't create the action/)).toBeVisible();

    await page.getByRole("link", { name: "Create action" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Create an action for Zoltan Sandoval/ })).toBeVisible();
    await page.getByRole("combobox", { name: "Action", exact: true }).selectOption("check_in");
    await page.getByRole("combobox", { name: /^Approach/ }).selectOption("client");
    await page.getByRole("button", { name: "Create action" }).click();
    await expect(drawer(page).getByText("Action created.")).toBeVisible();
    await expect(drawer(page).getByRole("button", { name: "Approve and send" })).toBeVisible();

    // Asking for a candidate redraft is blocked with the off-limits reason; the check-in stays.
    await drawer(page).locator("summary", { hasText: "Redraft" }).click();
    await drawer(page).getByRole("combobox", { name: "Approach" }).selectOption("candidate");
    await drawer(page).getByRole("button", { name: "Redraft" }).click();
    await expect(drawer(page).getByText(/Couldn't draft: a pre-action check blocks this message/)).toBeVisible();
    await expect(drawer(page).getByRole("button", { name: "Approve and send" })).toBeVisible();
  });

  test("scenario 17: the German contact's action exists but drafting is blocked, with no send control", async ({ page }) => {
    await page.goto("./actions?owner=all");
    await page.locator("[data-action-row]").filter({ hasText: "Blocked" }).first().click();
    await expect(drawer(page).getByText("Record a lawful basis before contacting this person.")).toBeVisible();
    await expect(drawer(page).getByRole("button", { name: "Approve and send" })).toHaveCount(0);
    await expect(drawer(page).getByLabel("Lawful basis: legitimate interest")).toBeVisible();
  });
});

test.describe("as the outreach owner", () => {
  test.use({ storageState: "tests/e2e/.auth/outreach.json" });

  test("keyboard only: opens a drafted action, edits the draft and submits it for approval", async ({ page }) => {
    await page.goto("./actions?owner=all&status=all&type=check_in");
    const card = page.locator("[data-action-row]").filter({ hasText: "Drafted", hasNotText: "Escalated" }).first();
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(drawer(page).getByRole("heading", { level: 2 })).toBeFocused();
    const body = drawer(page).getByRole("textbox", { name: /Email|LinkedIn message/ });
    await body.focus();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Looking forward to it.");
    const submit = drawer(page).getByRole("button", { name: "Submit for approval" });
    await submit.focus();
    await page.keyboard.press("Enter");
    await expect(drawer(page).getByText(/Sent for approval/)).toBeVisible();
    await expect(drawer(page).getByText("Waiting for a partner to approve.")).toBeVisible();
    await expect(drawer(page).getByRole("button", { name: "Approve and send" })).toHaveCount(0);
  });
});

test.describe("then as the partner again", () => {
  test.use({ storageState: "tests/e2e/.auth/partner.json" });

  test("approves and sends the submitted email by keyboard; the toast names the person; the outcome is recorded", async ({ page }) => {
    await page.goto("./actions?owner=all&status=awaiting_approval");
    const card = page.locator("[data-action-row]").first();
    const name = (await card.getAttribute("data-person"))!;
    await card.focus();
    await page.keyboard.press("Enter");
    const send = drawer(page).getByRole("button", { name: "Approve and send" });
    await expect(send).toBeVisible();
    const isEmail = await drawer(page).getByLabel("Subject").count();
    if (isEmail) {
      await send.focus();
      await page.keyboard.press("Enter");
      await expect(drawer(page).getByText(`Sent to ${name}.`)).toBeVisible();
    } else {
      await drawer(page).getByRole("button", { name: "Mark sent on LinkedIn" }).click();
      await expect(drawer(page).getByText(`Marked as sent to ${name} on LinkedIn.`)).toBeVisible();
    }
    await expect(drawer(page).getByRole("listitem").filter({ hasText: "Sent" }).first()).toBeVisible();
    await drawer(page).getByRole("combobox", { name: "What happened" }).selectOption("replied");
    await drawer(page).getByRole("button", { name: "Record outcome" }).click();
    await expect(drawer(page).getByText("Outcome recorded.")).toBeVisible();
  });

  test("Today shows the escalated action at the top of My actions", async ({ page }) => {
    await page.goto("./");
    const mine = page.getByRole("list", { name: "Due today and overdue" });
    await expect(mine.getByText("Escalated").first()).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test("the email log lists the staged digest", async ({ page }) => {
    await page.goto("./settings/email");
    await expect(page.getByRole("link", { name: /Your day in Demo Search Partners/ }).first()).toBeVisible();
    await page.getByRole("link", { name: /Your day in Demo Search Partners/ }).first().click();
    await expect(page.getByText(/Actions due today and overdue/)).toBeVisible();
  });
});

test.describe("as the data steward", () => {
  test.use({ storageState: "tests/e2e/.auth/steward.json" });

  test("scenario 17: recording a lawful basis unblocks drafting", async ({ page }) => {
    await page.goto("./actions?owner=all");
    await page.locator("[data-action-row]").filter({ hasText: "Blocked" }).first().click();
    await drawer(page).getByLabel("Lawful basis: legitimate interest").fill("Existing business relationship; contacted in a professional capacity.");
    await drawer(page).getByRole("button", { name: "Record lawful basis" }).click();
    await expect(drawer(page).getByText(/Lawful basis recorded/)).toBeVisible();
    await expect(drawer(page).getByText("Record a lawful basis before contacting this person.")).toHaveCount(0);
    await expect(drawer(page).getByRole("textbox", { name: /Email|LinkedIn message/ })).toBeVisible();
  });
});
