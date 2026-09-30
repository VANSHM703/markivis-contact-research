import { describe, expect, it } from "vitest";
import { rangesOverlap } from "@/domain/matching";
import { readTargetListFile, targetListTemplate, validateTargetRow } from "@/domain/imports/target-list";

describe("validateTargetRow", () => {
  it("accepts a company-only row", () => {
    const { row, issues } = validateTargetRow({ company_name: "Example Holdings", company_ownership: "PE-backed", company_tier: "Tier 2" });
    expect(issues).toEqual([]);
    expect(row!.company).toMatchObject({ name: "Example Holdings", ownership: "pe_backed", targetTier: 2 });
    expect(row!.person).toBeNull();
  });

  it("needs a name and title once any person column is filled", () => {
    const { issues } = validateTargetRow({ company_name: "Example", person_email: "a@example.com" });
    expect(issues.map((i) => i.column).sort()).toEqual(["person_full_name", "person_title"]);
  });

  it("normalises the LinkedIn URL, email, country and contact types", () => {
    const { row } = validateTargetRow({
      company_name: "Example",
      person_full_name: "Jane Example",
      person_title: "CFO",
      person_email: " Jane@Example.COM ",
      person_linkedin_url: "linkedin.com/in/Jane-Example",
      person_country: "de",
      person_contact_types: "Prospective client; referrer",
    });
    expect(row!.person).toMatchObject({
      email: "jane@example.com",
      linkedinUrl: "https://www.linkedin.com/in/jane-example",
      country: "DE",
      contactTypes: ["prospective_client", "referrer"],
    });
  });

  it("reports every problem on a row, by column, in plain words", () => {
    const { row, issues } = validateTargetRow({
      company_name: "",
      company_tier: "4",
      person_full_name: "X",
      person_title: "CEO",
      role_start_date: "2024-02-30",
      role_end_date: "2023-01-01",
      person_seat_type: "chair",
    });
    expect(row).toBeNull();
    expect(issues.map((i) => i.column).sort()).toEqual(["company_name", "company_tier", "person_seat_type", "role_start_date"]);
  });
});

describe("readTargetListFile", () => {
  it("maps aliases to the canonical columns and lists unknown ones", () => {
    const { rows, unknownColumns } = readTargetListFile("Company,Website,Name,Title,Favourite Colour\nExample,example.com,Jane,CEO,Blue\n");
    expect(rows[0]!.raw).toEqual({ company_name: "Example", company_domain: "example.com", person_full_name: "Jane", person_title: "CEO" });
    expect(unknownColumns).toEqual(["favourite_colour"]);
  });

  it("round-trips the template", () => {
    const { rows } = readTargetListFile(targetListTemplate());
    const { issues } = validateTargetRow(rows[0]!.raw);
    expect(issues).toEqual([]);
  });
});

describe("rangesOverlap", () => {
  it("treats open ends as unbounded", () => {
    expect(rangesOverlap({ from: "2020-01-01", to: null }, { from: null, to: null })).toBe(true);
    expect(rangesOverlap({ from: "2020-01-01", to: "2020-12-31" }, { from: "2021-01-01", to: null })).toBe(false);
    expect(rangesOverlap({ from: "2020-01-01", to: "2021-06-30" }, { from: "2021-06-30", to: null })).toBe(true);
  });
});
