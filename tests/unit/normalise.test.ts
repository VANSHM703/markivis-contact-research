import { describe, expect, it } from "vitest";
import { canonicalLinkedinUrl, normaliseCik, normaliseCompanyName, normaliseDomain, normaliseEmail, normaliseName } from "@/lib/normalise";

describe("normaliseName", () => {
  it("lowercases, strips accents, honorifics and suffixes", () => {
    expect(normaliseName("Dr. José Núñez Jr.")).toBe("jose nunez");
    expect(normaliseName("  Ms Anneliese  O'Brien-Hart PhD ")).toBe("anneliese obrienhart");
    expect(normaliseName("Sir")).toBe("sir");
  });
});

describe("normaliseCompanyName", () => {
  it("removes legal suffixes", () => {
    expect(normaliseCompanyName("Quarnell Systems, Inc.")).toBe("quarnell systems");
    expect(normaliseCompanyName("Penhallow Financial plc")).toBe("penhallow financial");
    expect(normaliseCompanyName("The Example Co")).toBe("example");
    expect(normaliseCompanyName("Brevik & Harlow LLC")).toBe("brevik and harlow");
  });
});

describe("canonicalLinkedinUrl", () => {
  it("returns the canonical profile URL", () => {
    expect(canonicalLinkedinUrl("linkedin.com/in/Jane-Example/")).toBe("https://www.linkedin.com/in/jane-example");
    expect(canonicalLinkedinUrl("https://uk.linkedin.com/in/jane-example?trk=abc")).toBe("https://www.linkedin.com/in/jane-example");
  });
  it("rejects non-profile URLs", () => {
    expect(canonicalLinkedinUrl("https://www.linkedin.com/company/example")).toBeNull();
    expect(canonicalLinkedinUrl("https://example.com/in/jane")).toBeNull();
    expect(canonicalLinkedinUrl("")).toBeNull();
  });
});

describe("normaliseDomain, normaliseEmail, normaliseCik", () => {
  it("normalises domains from URLs and emails", () => {
    expect(normaliseDomain("https://www.Example.com/about")).toBe("example.com");
    expect(normaliseDomain("jane@Sub.Example.org")).toBe("sub.example.org");
    expect(normaliseDomain("not a domain")).toBeNull();
  });
  it("lowercases valid emails and rejects invalid ones", () => {
    expect(normaliseEmail(" Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
    expect(normaliseEmail("jane@")).toBeNull();
  });
  it("zero-pads CIKs to 10 digits", () => {
    expect(normaliseCik("320193")).toBe("0000320193");
    expect(normaliseCik(9900001000)).toBe("9900001000");
    expect(normaliseCik("12345678901")).toBeNull();
  });
});
