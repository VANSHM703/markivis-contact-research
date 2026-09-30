import { describe, expect, it } from "vitest";
import { deriveFromRoles, type RoleSpan } from "@/domain/connections";
import { isGoingQuiet } from "@/domain/quiet";
import { bandOf, computeScore, DEFAULT_SCORING, spearman, type ScoreInteraction } from "@/domain/scoring";

const AS_OF = new Date("2026-09-30T12:00:00Z");
const ago = (days: number) => new Date(AS_OF.getTime() - days * 86_400_000);
const i = (channel: string, direction: string, days: number, threadKey: string | null = null): ScoreInteraction => ({ channel, direction, occurredAt: ago(days), threadKey });

describe("relationship score (BRD 11.4)", () => {
  it("matches the formula, worked by hand", () => {
    const rows = [
      i("meeting", "two_way", 10),
      i("call", "two_way", 40),
      i("email", "outbound", 60, "t1"),
      i("email", "inbound", 59, "t1"),
      i("email", "outbound", 100, "t2"),
      i("linkedin_message", "outbound", 20),
      i("newsletter_open", "not_applicable", 5),
      i("meeting", "two_way", 800),
    ];
    const r = computeScore(rows, AS_OF);
    // R = exp(-10/90); F = 3/12; Rc = 1 of 2 threads; D = (3 + 2 + 2 + 0.5) / 20; T = (800 / 365.25) / 5
    const expected = 100 * (0.3 * Math.exp(-10 / 90) + 0.25 * 0.25 + 0.2 * 0.5 + 0.15 * 0.375 + 0.1 * (800 / 365.25 / 5));
    expect(r.score).toBe(Math.round(expected));
    expect(r.score).toBe(53);
    expect(r.band).toBe("warm");
    expect(r.factors.frequency.raw.twoWayTouches12m).toBe(3);
    expect(r.factors.reciprocity.raw).toEqual({ inboundThreads12m: 1, threads12m: 2 });
    expect(r.factors.depth.raw).toEqual({ meetings: 1, calls: 1, emailThreads: 2, linkedinUnits: 1 });
    expect(r.lastTwoWayAt).toEqual(ago(10));
  });

  it("counts a thread as two-way only with both directions within 30 days", () => {
    const slow = computeScore([i("email", "outbound", 100, "t"), i("email", "inbound", 60, "t")], AS_OF);
    expect(slow.factors.frequency.raw.twoWayTouches12m).toBe(0);
    expect(slow.factors.recency.value).toBe(0);
    const quick = computeScore([i("email", "outbound", 100, "t"), i("email", "inbound", 80, "t")], AS_OF);
    expect(quick.factors.frequency.raw.twoWayTouches12m).toBe(1);
  });

  it("gives newsletter opens no weight and newsletter clicks depth only", () => {
    expect(computeScore([i("newsletter_open", "not_applicable", 3)], AS_OF)).toMatchObject({ score: 0, band: "none" });
    const click = computeScore([i("newsletter_click", "not_applicable", 3)], AS_OF);
    expect(click.factors.depth.raw.linkedinUnits).toBe(1);
    expect(click.factors.frequency.value).toBe(0);
  });

  it("maps scores to bands at the default thresholds", () => {
    const b = DEFAULT_SCORING.bands;
    expect([100, 70, 69, 45, 44, 25, 24, 1, 0].map((s) => bandOf(s, b))).toEqual(["strong", "strong", "warm", "warm", "cooling", "cooling", "cold", "cold", "none"]);
    expect(bandOf(50, b, false)).toBe("none");
  });

  it("measures rank agreement for calibration", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1);
    expect(spearman([1, 2, 2, 4], [1, 2, 3, 4])).toBeGreaterThan(0.9);
  });
});

describe("going quiet (BRD 11.5, scenario 14)", () => {
  const warmThenSilent = (silentDays: number) => {
    const rows: (ScoreInteraction & { personId: string; ourUserId: string | null })[] = [];
    // A warm relationship: frequent meetings and replies until `silentDays` ago.
    for (let d = silentDays; d < silentDays + 200; d += 20) rows.push({ ...i("meeting", "two_way", d), personId: "p", ourUserId: "u" }, { ...i("email", "outbound", d + 2, `t${d}`), personId: "p", ourUserId: "u" }, { ...i("email", "inbound", d + 1, `t${d}`), personId: "p", ourUserId: "u" });
    return rows;
  };
  it("is quiet after 91 silent days when the band was warm within 180 days", () => {
    const rows = warmThenSilent(91);
    expect(computeScore(rows, ago(91)).band).toMatch(/strong|warm/);
    expect(isGoingQuiet(rows, AS_OF, DEFAULT_SCORING, 90)).toEqual({ quiet: true, daysSilent: 91 });
  });
  it("is not quiet before the quiet period, or if the band was never warm", () => {
    expect(isGoingQuiet(warmThenSilent(80), AS_OF, DEFAULT_SCORING, 90).quiet).toBe(false);
    // Mail that never got a reply: never two-way, so never warm.
    const coldOnly = [{ ...i("email", "outbound", 150, "x"), personId: "p", ourUserId: "u" }, { ...i("email", "outbound", 120, "y"), personId: "p", ourUserId: "u" }];
    expect(isGoingQuiet(coldOnly, AS_OF, DEFAULT_SCORING, 90).quiet).toBe(false);
  });
});

describe("connections derived from roles (BRD 11.6)", () => {
  const span = (personId: string, over: Partial<RoleSpan>): RoleSpan => ({ personId, companyId: "c", seatType: "executive", seniority: "c_suite", function: null, start: "2020-01-01", end: null, status: "current", employeeCount: 800, ...over });
  const settings = { max_company_size: 2000, board_overlap_months: 6, exec_overlap_months: 12 };
  const today = "2026-09-30";

  it("links board members who overlapped 6 months or more", () => {
    const got = deriveFromRoles([span("a", { seatType: "board", seniority: "board", start: "2026-01-01" }), span("b", { seatType: "board", seniority: "board", start: "2025-06-01" })], today, settings);
    expect(got).toEqual([expect.objectContaining({ a: "a", b: "b", type: "shared_board", weight: 0.8, periodStart: "2026-01-01", periodEnd: today })]);
    expect(deriveFromRoles([span("a", { seatType: "board", start: "2026-06-01" }), span("b", { seatType: "board", start: "2020-01-01" })], today, settings)).toEqual([]);
  });

  it("links executives who overlapped a year at a smaller company, higher in the same function", () => {
    const other = deriveFromRoles([span("a", { function: "Finance" }), span("b", { seniority: "vp", function: "Sales" })], today, settings);
    expect(other[0]).toMatchObject({ type: "overlapping_tenure", weight: 0.6 });
    const same = deriveFromRoles([span("a", { function: "Finance" }), span("b", { seniority: "vp", function: "finance" })], today, settings);
    expect(same[0]).toMatchObject({ type: "overlapping_tenure", weight: 0.7 });
    expect(deriveFromRoles([span("a", { employeeCount: 5000 }), span("b", { employeeCount: 5000 })], today, settings)).toEqual([]);
    expect(deriveFromRoles([span("a", { seniority: "vp" }), span("b", { seniority: "svp" })], today, settings)).toEqual([]);
  });

  it("links a C-suite executive and a board member after 12 months, and skips announced roles", () => {
    expect(deriveFromRoles([span("a", {}), span("b", { seatType: "board", seniority: "board" })], today, settings)[0]).toMatchObject({ type: "shared_board", weight: 0.75 });
    expect(deriveFromRoles([span("a", { status: "announced" }), span("b", { seatType: "board" })], today, settings)).toEqual([]);
  });
});
