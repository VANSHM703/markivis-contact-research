import { describe, expect, it } from "vitest";
import { postCheck } from "@/domain/actions";
import { addWorkingDays, isoWeek, weekStart } from "@/lib/working-days";
import { normaliseText, prefilter, type WorkspaceIndex } from "@/pipeline/prefilter";
import { basePriority, combineConfidence, dedupeKey, laneOf, priorityOf, priorityOverrides, sourceStrength, withinDays } from "@/pipeline/rules";

const ctx = { companyDomain: "example.com", reputableOutlets: ["news.example.org"] };
const src = (sourceType: string, url: string | null, quoted = true) => ({ rawItemId: url, sourceType, url, quoted });

describe("confidence (BRD 9.4)", () => {
  it("rates primary sources high", () => {
    expect(sourceStrength(src("sec_8k", "https://www.sec.gov/a"), ctx)).toMatchObject({ level: "high", primary: true });
    expect(sourceStrength(src("leadership_page", "https://example.com/leadership"), ctx)).toMatchObject({ level: "high", primary: true });
    expect(sourceStrength(src("press_wire", "https://www.example.com/news/1"), ctx)).toMatchObject({ level: "high", primary: true });
  });
  it("rates wires, Apollo and reputable outlets medium, and aggregators low", () => {
    expect(sourceStrength(src("press_wire", "https://wire.example.net/1"), ctx).level).toBe("medium");
    expect(sourceStrength(src("apollo", null), ctx).level).toBe("medium");
    expect(sourceStrength(src("google_alert", "https://news.example.org/a"), ctx).level).toBe("medium");
    expect(sourceStrength(src("google_alert", "https://blog.example.net/a"), ctx).level).toBe("low");
  });
  it("rates AI inference without a verbatim quote low", () => {
    expect(sourceStrength(src("sec_8k", "https://www.sec.gov/a", false), ctx)).toMatchObject({ level: "low", primary: false });
  });
  it("two independent medium sources make high, but not primary", () => {
    expect(combineConfidence([src("press_wire", "https://wire.example.net/1"), src("press_wire", "https://wire.example.net/2")], ctx)).toMatchObject({ confidence: "high", primary: false });
    expect(combineConfidence([src("press_wire", "https://wire.example.net/1"), src("press_wire", "https://wire.example.net/1")], ctx).confidence).toBe("medium");
    expect(combineConfidence([src("press_wire", "https://wire.example.net/1"), src("google_alert", "https://blog.example.net/a")], ctx).confidence).toBe("medium");
  });
});

describe("dedupe (BRD 9.5)", () => {
  it("keys on subject, type and ISO week of the event", () => {
    expect(dedupeKey("p1", "person_left", "2026-09-28")).toBe("p1:person_left:2026-W40");
    expect(dedupeKey("p1", "person_left", "2026-10-04")).toBe("p1:person_left:2026-W40");
    expect(dedupeKey("p1", "person_left", "2026-10-05")).toBe("p1:person_left:2026-W41");
    expect(withinDays("2026-10-04", "2026-10-07", 3)).toBe(true);
    expect(withinDays("2026-10-04", "2026-10-08", 3)).toBe(false);
  });
});

describe("priority (BRD 9.3, 7.3)", () => {
  it("uses the table, overrides for placed executives, and lowers moves off the list", () => {
    expect(priorityOf({ type: "person_promotion", personIsPlaced: false, offList: false }).priority).toBe(2);
    expect(priorityOf({ type: "person_promotion", personIsPlaced: true, offList: false }).priority).toBe(1);
    expect(priorityOf({ type: "person_joined", personIsPlaced: false, offList: true }).priority).toBe(2);
    expect(priorityOf({ type: "company_layoffs", personIsPlaced: true, offList: false }).priority).toBe(2);
  });

  it("takes the workspace's priority for a type, and still puts a placed executive's move first", () => {
    const overrides = priorityOverrides({ signal_priorities: { person_promotion: 3, company_layoffs: 1, person_award: 7, not_a_type: 1 } });
    expect(overrides).toEqual({ person_promotion: 3, company_layoffs: 1 });
    expect(priorityOf({ type: "company_layoffs", personIsPlaced: false, offList: false, overrides })).toEqual({ priority: 1, reason: "Workspace priority for company layoffs" });
    expect(priorityOf({ type: "person_promotion", personIsPlaced: false, offList: false, overrides }).priority).toBe(3);
    expect(priorityOf({ type: "person_promotion", personIsPlaced: true, offList: false, overrides }).priority).toBe(1);
    expect(basePriority("person_award", overrides)).toBe(3);
    expect(priorityOverrides(null)).toEqual({});
  });
});

describe("lanes (BRD 10.1)", () => {
  const base = { type: "person_left" as const, priority: 1 as const, confidence: { confidence: "high" as const, primary: true, reason: "SEC filing" }, matchScore: 0.95, strongMatch: true, sourceSuspended: false, batchP3: true };
  it("auto-confirms only when every condition holds", () => {
    expect(laneOf(base).lane).toBe("auto_confirm");
    expect(laneOf({ ...base, matchScore: 0.89 }).lane).toBe("review");
    expect(laneOf({ ...base, strongMatch: false }).lane).toBe("review");
    expect(laneOf({ ...base, sourceSuspended: true }).lane).toBe("review");
    expect(laneOf({ ...base, confidence: { confidence: "high", primary: false, reason: "two sources" } }).lane).toBe("review");
    expect(laneOf({ ...base, type: "person_promotion", priority: 2 }).lane).toBe("review");
  });
  it("sends P3 with medium or high confidence to the weekly batch, low to review", () => {
    expect(laneOf({ ...base, type: "person_award", priority: 3, confidence: { confidence: "medium", primary: false, reason: "" } }).lane).toBe("weekly_batch");
    expect(laneOf({ ...base, type: "person_award", priority: 3, confidence: { confidence: "low", primary: false, reason: "" } }).lane).toBe("review");
    expect(laneOf({ ...base, type: "person_award", priority: 3, batchP3: false, confidence: { confidence: "medium", primary: false, reason: "" } }).lane).toBe("review");
  });
});

describe("pre-filter (BRD 9.2)", () => {
  const index: WorkspaceIndex = {
    companies: [{ id: "c1", name: "Quarnell Systems, Inc.", nameNormalised: "quarnell systems", aliases: ["QRNL"], domain: "quarnell.example.com", secCik: "9900001000" }],
    people: [{ id: "p1", name: "Jane Example", nameNormalised: "jane example", companyId: "c1", companyName: "Quarnell Systems, Inc.", title: "CFO" }],
    byCompany: new Map([["c1", [{ id: "p1", name: "Jane Example", nameNormalised: "jane example", companyId: "c1", companyName: "Quarnell Systems, Inc.", title: "CFO" }]]]),
  };
  const run = (title: string, body = "", sourceType = "google_alert", url: string | null = null) => prefilter({ sourceType, title, bodyText: body, url, payload: null }, index);
  it("passes an item that names a tracked company, by name, ticker or domain", () => {
    expect(run("Quarnell Systems beats estimates").pass).toBe(true);
    expect(run("Shares of QRNL rose").pass).toBe(true);
    expect(run("Earnings", "", "press_wire", "https://quarnell.example.com/news").strongCompanyIds).toEqual(["c1"]);
  });
  it("passes a named person only with a leadership term", () => {
    expect(run("Jane Example appointed to the board of a nonprofit").pass).toBe(true);
    expect(run("Jane Example wins the local marathon").pass).toBe(false);
    expect(run("Weather is fine").pass).toBe(false);
  });
  it("offers the named people and the people at named companies as candidates", () => {
    expect(run("Quarnell Systems restructures").candidates.map((c) => c.id).sort()).toEqual(["c1", "p1"]);
  });
  it("normalises text for whole-word matching", () => {
    expect(normaliseText("José O'Brien-Hart & Co.")).toBe(" jose obrien hart and co ");
  });
});

describe("working days (BRD 12.8)", () => {
  it("skips weekends, in the workspace's time zone, due at 17:00 local", () => {
    // Friday Oct 2, 2026 at 15:00 in New York plus 2 working days is Tuesday Oct 6 at 17:00 EDT.
    expect(addWorkingDays(new Date("2026-10-02T19:00:00Z"), 2).toISOString()).toBe("2026-10-06T21:00:00.000Z");
    expect(addWorkingDays(new Date("2026-10-06T19:00:00Z"), -2).toISOString()).toBe("2026-10-02T21:00:00.000Z");
    expect(weekStart(new Date("2026-10-04T12:00:00Z"))).toBe("2026-09-28");
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
  });
});

describe("draft post-check (BRD 17.2)", () => {
  it("flags numbers, companies and people that are not in the context", () => {
    const context = JSON.stringify({ person: "Jane Example", company: "Quarnell Systems" });
    expect(postCheck("Congratulations, Jane Example.", context, { companies: ["Quarnell Systems", "Other Co"], people: ["Jane Example", "Omar Example"] })).toEqual([]);
    expect(postCheck("Since 2019 at Other Co with Omar Example", context, { companies: ["Other Co"], people: ["Omar Example"] })).toEqual([
      "Number not in context: 2019",
      "Company not in context: Other Co",
      "Person not in context: Omar Example",
    ]);
  });
});
