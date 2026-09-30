import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isNavItemActive, navItemsForRole } from "@/config/navigation";

const labels = (role: Parameters<typeof navItemsForRole>[0]) => navItemsForRole(role).map((item) => item.label);

describe("navigation", () => {
  it("keeps the order fixed by BRD section 16.1", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "Today", "Actions", "Queue", "People", "Companies", "Signals", "Paths", "Coverage", "Settings",
    ]);
  });

  it("shows Queue only to partner and validator, and Settings only to partner and data steward", () => {
    expect(labels("partner")).toContain("Queue");
    expect(labels("partner")).toContain("Settings");
    expect(labels("validator")).toContain("Queue");
    expect(labels("validator")).not.toContain("Settings");
    expect(labels("data_steward")).toContain("Settings");
    expect(labels("data_steward")).not.toContain("Queue");
    expect(labels("outreach_owner")).not.toContain("Queue");
    expect(labels("outreach_owner")).not.toContain("Settings");
    expect(labels("account_lead")).not.toContain("Queue");
  });

  it("matches Today only on its own route and other items on nested routes", () => {
    const today = NAV_ITEMS[0]!;
    const people = NAV_ITEMS.find((item) => item.label === "People")!;
    expect(isNavItemActive(today, "/")).toBe(true);
    expect(isNavItemActive(today, "/people")).toBe(false);
    expect(isNavItemActive(people, "/people/123")).toBe(true);
    expect(isNavItemActive(people, "/peoplex")).toBe(false);
  });
});
