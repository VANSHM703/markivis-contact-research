/** Security headers and the Content Security Policy in the production build (BRD 18.3). */
import { expect, test } from "@playwright/test";

const PAGES = ["", "actions?owner=all", "queue", "people", "companies", "signals", "paths?q=Lindqvist", "coverage", "settings", "settings/scoring", "settings/members", "settings/audit", "settings/content", "people/not-a-real-id"];

test("every page sends the security headers and a nonce-based policy, and nothing is blocked", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  for (const path of PAGES) {
    const response = await page.goto(`./${path}`);
    const h = response!.headers();
    expect(h["content-security-policy"], path).toMatch(/default-src 'self'.*script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).not.toMatch(/fonts\.googleapis|unsafe-eval/);
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["x-powered-by"]).toBeUndefined();
    await page.waitForLoadState("networkidle");
  }
  // Client-side behaviour still works under the policy: the global search shortcut focuses the box.
  await page.goto("./");
  await expect(async () => {
    await page.keyboard.press("/");
    await expect(page.getByRole("searchbox", { name: "Search people and companies" })).toBeFocused({ timeout: 500 });
  }).toPass({ timeout: 15_000 });
  expect(violations).toEqual([]);
});
