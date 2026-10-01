/** The export building blocks (BRD 18.2, 18.4): the streaming ZIP writer and CSV cells. */
import { describe, expect, it } from "vitest";
import { cell, csvLine, toCsv } from "@/lib/export/csv";
import { zip } from "@/lib/export/zip";
import { readAll, unzip } from "../helpers/unzip";

describe("zip", () => {
  it("writes entries that inflate back to their content, with sizes and CRCs right", async () => {
    async function* big() {
      for (let i = 0; i < 300; i++) yield `${i},${"x".repeat(i % 50)},Zoë\r\n`;
    }
    const bytes = await readAll(zip([
      { name: "README.txt", content: ["hello"] },
      { name: "csv/people.csv", content: big() },
      { name: "empty.json", content: [] },
      { name: "naïve/ünïcode.txt", content: [Buffer.from("bytes")] },
    ], new Date("2026-09-30T12:00:00Z")));
    const files = unzip(bytes);
    expect([...files.keys()]).toEqual(["README.txt", "csv/people.csv", "empty.json", "naïve/ünïcode.txt"]);
    expect(files.get("README.txt")!.toString()).toBe("hello");
    expect(files.get("empty.json")!.length).toBe(0);
    const csv = files.get("csv/people.csv")!.toString("utf8");
    expect(csv.split("\r\n").length).toBe(301);
    expect(csv).toContain("299,");
    expect(csv).toContain("Zoë");
    expect(files.get("naïve/ünïcode.txt")!.toString()).toBe("bytes");
  });

  it("stops at the source's error rather than writing a broken archive", async () => {
    async function* failing() {
      yield "start";
      throw new Error("database went away");
    }
    await expect(readAll(zip([{ name: "a.csv", content: failing() }]))).rejects.toThrow("database went away");
  });
});

describe("csv cells", () => {
  it("quotes what needs quoting and writes JSON for structures", () => {
    expect(cell(null)).toBe("");
    expect(cell("plain")).toBe("plain");
    expect(cell('say "hi", then')).toBe('"say ""hi"", then"');
    expect(cell("two\nlines")).toBe('"two\nlines"');
    expect(cell(["a", "b"])).toBe('"[""a"",""b""]"');
    expect(cell(new Date("2026-09-30T12:00:00Z"))).toBe("2026-09-30T12:00:00.000Z");
    expect(csvLine([1, "a", null])).toBe("1,a,\r\n");
    expect(toCsv(["id", "name"], [{ id: 1, name: "Ada" }])).toBe("id,name\r\n1,Ada\r\n");
  });

  it("disarms text a spreadsheet would run as a formula, but leaves numbers alone", () => {
    expect(cell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(cell("+1 555 0100")).toBe("'+1 555 0100");
    expect(cell("@handle")).toBe("'@handle");
    expect(cell("-0.25")).toBe("-0.25");
    expect(cell(-3)).toBe("-3");
  });
});
