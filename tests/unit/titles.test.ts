import { describe, expect, it } from "vitest";
import { normaliseTitle } from "@/domain/titles";

describe("normaliseTitle", () => {
  it.each([
    ["Chief Executive Officer", "CEO", "General management", "c_suite", "executive"],
    ["President and CEO", "CEO", "General management", "c_suite", "executive"],
    ["EVP & Chief Financial Officer", "CFO", "Finance", "c_suite", "executive"],
    ["Chief People Officer", "CHRO", "People", "c_suite", "executive"],
    ["Chief Information Officer", "CIO", "Technology", "c_suite", "executive"],
    ["General Counsel and Corporate Secretary", "GC", "Legal", "c_suite", "executive"],
    ["Chair of the Board", "Chair", "Board", "board", "board"],
    ["Non-Executive Director", "Director", "Board", "board", "board"],
    ["Independent Director", "Director", "Board", "board", "board"],
    ["Senior Vice President, Operations", "SVP", "Operations", "svp", "executive"],
    ["VP, Talent Acquisition", "VP", "People", "vp", "executive"],
    ["Director of Engineering", "Director", "Technology", "other", "executive"],
    ["Head of Partnerships", "Other", null, "other", "executive"],
  ])("%s", (title, norm, fn, seniority, seatType) => {
    expect(normaliseTitle(title)).toEqual({ titleNormalised: norm, function: fn, seniority, seatType });
  });
});
