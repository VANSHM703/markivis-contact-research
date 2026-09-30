import { describe, expect, it } from "vitest";
import { createMockAi } from "@/ai/mock";
import type { DraftInput } from "@/ai/contracts";
import { readPackFile, packTemplate } from "@/domain/imports/pack";
import { ImportFileError } from "@/domain/imports/target-list";
import { describeRule, offLimitsSchema, ruleState } from "@/domain/off-limits";
import { execSearchOn } from "@/lib/packs";

const COMPANY = "0b7d3f4e-8a1c-4c2b-9e3f-5d6a7b8c9d0e";

describe("the executive search pack switch (BRD 13)", () => {
  it("is on only when packs.exec_search is true and the flag is not off", () => {
    expect(execSearchOn({ packs: { exec_search: true }, flags: {} })).toBe(true);
    expect(execSearchOn({ packs: { exec_search: true }, flags: { "pack.exec_search": false } })).toBe(false);
    expect(execSearchOn({ packs: { exec_search: false }, flags: { "pack.exec_search": true } })).toBe(false);
    expect(execSearchOn({ packs: {}, flags: {} })).toBe(false);
    expect(execSearchOn(null)).toBe(false);
  });
});

describe("off-limits rules", () => {
  const base = { companyId: COMPANY, scope: "company", reason: "current_client", startsOn: "2026-01-01" };
  it("validates scope-specific fields and dates", () => {
    expect(offLimitsSchema.safeParse(base).success).toBe(true);
    const noFunction = offLimitsSchema.safeParse({ ...base, scope: "function" });
    expect(noFunction.success).toBe(false);
    expect(noFunction.error?.issues[0]?.path).toEqual(["function"]);
    expect(offLimitsSchema.safeParse({ ...base, scope: "level_and_above" }).success).toBe(false);
    expect(offLimitsSchema.safeParse({ ...base, scope: "level_and_above", minSeniority: "svp" }).success).toBe(true);
    expect(offLimitsSchema.safeParse({ ...base, endsOn: "2025-12-31" }).success).toBe(false);
    expect(offLimitsSchema.safeParse({ ...base, startsOn: "2026-02-30" }).success).toBe(false);
    expect(offLimitsSchema.safeParse({ ...base, reason: "friendly" }).success).toBe(false);
  });

  it("knows whether a rule is upcoming, active or ended, and says what it covers", () => {
    expect(ruleState({ startsOn: "2026-10-01", endsOn: null }, "2026-09-30")).toBe("upcoming");
    expect(ruleState({ startsOn: "2026-01-01", endsOn: "2026-09-30" }, "2026-09-30")).toBe("active");
    expect(ruleState({ startsOn: "2026-01-01", endsOn: "2026-09-29" }, "2026-09-30")).toBe("ended");
    expect(describeRule({ scope: "company", function: null, minSeniority: null })).toBe("Whole company");
    expect(describeRule({ scope: "function", function: "Finance", minSeniority: null })).toBe("Finance function");
    expect(describeRule({ scope: "level_and_above", function: null, minSeniority: "svp" })).toBe("SVP and above");
  });
});

describe("pack imports", () => {
  it("maps aliases and reports missing required columns", () => {
    const { rows, unknownColumns } = readPackFile("placements", "Name,Company,Title,Date,Notes\nJordan Example,Example Holdings,CFO,2024-03-18,x\n");
    expect(rows[0]!.raw).toEqual({ person_full_name: "Jordan Example", company_name: "Example Holdings", role_title: "CFO", placed_on: "2024-03-18" });
    expect(unknownColumns).toEqual(["notes"]);
    expect(() => readPackFile("off_limits", "company_name,scope\nX,company\n")).toThrow(ImportFileError);
  });

  it("offers a template with every column and a fictional example", () => {
    const [header, example] = packTemplate("off_limits").trim().split("\n");
    expect(header).toBe("company_name,scope,reason,starts_on,ends_on,function,min_seniority,company_domain");
    expect(example).toContain("example.com");
  });
});

describe("drafts follow the contact type (BRD 13)", () => {
  const input = (approach: DraftInput["approach"]): DraftInput => ({
    partnerName: "Jordan Ellis", styleGuide: "", person: { preferredName: "Jane", fullName: "Jane Example", role: "CFO", company: "Example", contactTypes: [], country: "US" },
    signal: null, suggestedAction: "check_in", bestPath: null, recentInteractions: [], band: null, contentItem: null, channel: "email", approach,
  });
  it("writes a client message about the leadership team and a candidate message about their career, never both", async () => {
    const ai = createMockAi(() => new Date("2026-09-30T12:00:00Z"));
    const client = (await ai.draftMessage(input("client"))).output.body;
    const candidate = (await ai.draftMessage(input("candidate"))).output.body;
    expect(client).toMatch(/leadership team/);
    expect(client).not.toMatch(/next step|search you may/);
    expect(candidate).toMatch(/your own next step/);
    expect(candidate).not.toMatch(/leadership team/);
  });
});
