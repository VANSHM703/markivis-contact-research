/**
 * CSV and JSON cells for exports. Dates become ISO 8601 in UTC, arrays and objects become JSON,
 * and text that a spreadsheet would run as a formula is prefixed with an apostrophe (OWASP CSV
 * injection guidance). JSON files keep the values as they are.
 */

export type Row = Record<string, unknown>;

const FORMULA = /^[=+\-@\t\r]/;
const NUMBER = /^-?\d+(\.\d+)?$/;

export function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (Buffer.isBuffer(value)) text = value.toString("base64");
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);
  if (typeof value === "string" && FORMULA.test(text) && !NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: unknown[]): string {
  return `${values.map(cell).join(",")}\r\n`;
}

export function toCsv(columns: string[], rows: Row[]): string {
  return csvLine(columns) + rows.map((r) => csvLine(columns.map((c) => r[c]))).join("");
}

/** JSON with dates as ISO strings and binary as base64. */
export function toJson(value: unknown, space?: number): string {
  return JSON.stringify(value, (_key, v: unknown) => (v && typeof v === "object" && (v as { type?: string }).type === "Buffer" && Array.isArray((v as { data?: unknown }).data) ? Buffer.from((v as { data: number[] }).data).toString("base64") : v), space);
}
