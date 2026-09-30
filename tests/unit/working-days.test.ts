import { describe, expect, it } from "vitest";
import { workingDaysBetween } from "@/server/today";

describe("workingDaysBetween", () => {
  it("counts Monday to Friday only", () => {
    // Friday Sep 25, 2026 to Tuesday Sep 29, 2026: Monday and Tuesday.
    expect(workingDaysBetween(new Date("2026-09-25T10:00:00Z"), new Date("2026-09-29T10:00:00Z"))).toBe(2);
    // Across a full week.
    expect(workingDaysBetween(new Date("2026-09-21T10:00:00Z"), new Date("2026-09-28T10:00:00Z"))).toBe(5);
  });
  it("is zero when the end is not after the start", () => {
    expect(workingDaysBetween(new Date("2026-09-29T10:00:00Z"), new Date("2026-09-29T09:00:00Z"))).toBe(0);
  });
});
