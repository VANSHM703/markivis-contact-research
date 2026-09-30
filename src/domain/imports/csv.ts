/**
 * RFC 4180 CSV parsing: quoted fields, escaped quotes, commas and line breaks inside quotes,
 * CRLF or LF line endings, and a UTF-8 byte-order mark (as Excel writes). Pure.
 */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  /** Row numbers as a spreadsheet shows them: the header is row 1, the first data row is row 2. */
  rowNumbers: number[];
}

export class CsvError extends Error {}

export function parseCsvRecords(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  while (i < input.length) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
      i++;
    } else if (char === ",") {
      record.push(field);
      field = "";
      i++;
    } else if (char === "\n" || char === "\r") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      i += char === "\r" && input[i + 1] === "\n" ? 2 : 1;
    } else {
      field += char;
      i++;
    }
  }
  if (quoted) throw new CsvError("A quoted field is never closed. Check for a missing quotation mark.");
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/** Lowercase, trimmed, spaces and dashes to underscores: "Person Full Name" becomes "person_full_name". */
export function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

export function parseCsv(text: string): ParsedCsv {
  const records = parseCsvRecords(text);
  const headerIndex = records.findIndex((r) => r.some((v) => v.trim() !== ""));
  if (headerIndex === -1) throw new CsvError("The file is empty.");
  const headers = records[headerIndex]!.map(normaliseHeader);
  const duplicate = headers.find((h, i) => h && headers.indexOf(h) !== i);
  if (duplicate) throw new CsvError(`The column "${duplicate}" appears twice.`);

  const rows: Record<string, string>[] = [];
  const rowNumbers: number[] = [];
  records.slice(headerIndex + 1).forEach((record, offset) => {
    if (record.every((v) => v.trim() === "")) return;
    rows.push(Object.fromEntries(headers.map((h, i) => [h, (record[i] ?? "").trim()]).filter(([h]) => h)));
    rowNumbers.push(headerIndex + offset + 2);
  });
  return { headers, rows, rowNumbers };
}
