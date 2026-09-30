import { describe, expect, it } from "vitest";
import { CsvError, normaliseHeader, parseCsv, parseCsvRecords } from "@/domain/imports/csv";

describe("parseCsvRecords", () => {
  it("handles quotes, escaped quotes, commas and line breaks inside quotes", () => {
    expect(parseCsvRecords('a,"b, c","say ""hi""","line\nbreak"\n1,2,3,4')).toEqual([
      ["a", "b, c", 'say "hi"', "line\nbreak"],
      ["1", "2", "3", "4"],
    ]);
  });
  it("handles CRLF, a byte-order mark and a missing final newline", () => {
    expect(parseCsvRecords("﻿a,b\r\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps empty fields", () => {
    expect(parseCsvRecords("a,,c\n,,\n")).toEqual([["a", "", "c"], ["", "", ""]]);
  });
  it("reports an unclosed quote", () => {
    expect(() => parseCsvRecords('a,"b\n1,2')).toThrow(CsvError);
  });
});

describe("parseCsv", () => {
  it("normalises headers, skips blank rows and numbers rows as a spreadsheet does", () => {
    const parsed = parseCsv("Company Name, Full-Name \nAcme,Jane\n\n,,\nBeta,Joe\n");
    expect(parsed.headers).toEqual(["company_name", "full_name"]);
    expect(parsed.rows).toEqual([{ company_name: "Acme", full_name: "Jane" }, { company_name: "Beta", full_name: "Joe" }]);
    expect(parsed.rowNumbers).toEqual([2, 5]);
  });
  it("rejects duplicate columns and empty files", () => {
    expect(() => parseCsv("a,A\n1,2")).toThrow(/appears twice/);
    expect(() => parseCsv("\n\n")).toThrow(/empty/);
  });
  it("normaliseHeader", () => {
    expect(normaliseHeader(" Person LinkedIn URL ")).toBe("person_linkedin_url");
  });
});
