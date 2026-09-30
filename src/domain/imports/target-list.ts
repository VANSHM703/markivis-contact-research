/**
 * Target list import (BRD 16.4): companies, and the people at them, from one CSV. The flow is
 * parse, validate and preview (no writes), then commit in one transaction, reporting created,
 * matched, conflicting and rejected rows. Matching follows BRD 7.2; suppression is checked first.
 * Column definitions are logged in DECISIONS.md.
 */
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { queueItems } from "@/db/schema";
import { canonicalLinkedinUrl, normaliseCik, normaliseDomain, normaliseEmail } from "@/lib/normalise";
import { matchPerson, resolveCompany } from "../matching";
import { findOrCreateCompany, upsertPerson, type Actor, type Ownership, type SourceNote } from "../records";
import { isSuppressed, SuppressedError } from "../suppression";
import type { SeatType } from "../titles";
import { parseCsv, type ParsedCsv } from "./csv";

export const MAX_IMPORT_ROWS = 20_000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export interface ColumnSpec {
  key: string;
  aliases: string[];
  required?: "always" | "with_person";
  description: string;
  example: string;
}

export const TARGET_LIST_COLUMNS: ColumnSpec[] = [
  { key: "company_name", aliases: ["company"], required: "always", description: "Company name", example: "Example Holdings, Inc." },
  { key: "company_domain", aliases: ["domain", "website"], description: "Website or domain", example: "example.com" },
  { key: "company_ticker", aliases: ["ticker"], description: "Stock ticker, for public companies", example: "EXMP" },
  { key: "company_sec_cik", aliases: ["cik", "sec_cik"], description: "SEC CIK, up to 10 digits", example: "0000123456" },
  { key: "company_ownership", aliases: ["ownership"], description: "public, pe_backed, vc_backed, private, non_profit or unknown", example: "pe_backed" },
  { key: "company_tier", aliases: ["tier", "target_tier"], description: "Target tier: 1, 2 or 3", example: "1" },
  { key: "company_industry", aliases: ["industry", "sector"], description: "Industry", example: "Healthcare services" },
  { key: "company_hq_country", aliases: ["hq_country"], description: "Headquarters country, two-letter code", example: "US" },
  { key: "company_employee_count", aliases: ["employees", "employee_count"], description: "Number of employees", example: "1200" },
  { key: "company_client_status", aliases: ["client_status"], description: "client, prospect or none", example: "prospect" },
  { key: "person_full_name", aliases: ["full_name", "name", "person_name"], required: "with_person", description: "Full name", example: "Jordan Example" },
  { key: "person_title", aliases: ["title", "job_title"], required: "with_person", description: "Title as published", example: "Chief Financial Officer" },
  { key: "person_seat_type", aliases: ["seat_type"], description: "executive, board, advisory, pe_operating_partner, pe_deal_partner or other. Worked out from the title when blank", example: "executive" },
  { key: "person_email", aliases: ["email", "business_email"], description: "Business email", example: "jordan@example.com" },
  { key: "person_linkedin_url", aliases: ["linkedin", "linkedin_url"], description: "LinkedIn profile URL", example: "https://www.linkedin.com/in/jordan-example" },
  { key: "person_city", aliases: ["city"], description: "City", example: "Boston" },
  { key: "person_country", aliases: ["country"], description: "Country, two-letter code", example: "US" },
  { key: "person_contact_types", aliases: ["contact_types", "contact_type"], description: "Separated by semicolons: prospective_client, potential_candidate, referrer, sponsor_contact", example: "prospective_client; referrer" },
  { key: "role_start_date", aliases: ["start_date", "effective_on"], description: "Start date, YYYY-MM-DD", example: "2023-04-01" },
  { key: "role_end_date", aliases: ["end_date", "ended_on"], description: "End date, YYYY-MM-DD, for a past role", example: "" },
  { key: "source_url", aliases: [], description: "Where this row was found", example: "https://example.com/leadership" },
  { key: "source_note", aliases: ["note"], description: "How you know this, when it differs from the file's note", example: "" },
];

const PERSON_KEYS = TARGET_LIST_COLUMNS.filter((c) => c.key.startsWith("person_") || c.key.startsWith("role_")).map((c) => c.key);

/** Header row and one example row, for the downloadable template. */
export function targetListTemplate(): string {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [TARGET_LIST_COLUMNS.map((c) => c.key).join(","), TARGET_LIST_COLUMNS.map((c) => escape(c.example)).join(",")].join("\n") + "\n";
}

// ---------------------------------------------------------------------------------------------
// Parsing and validation
// ---------------------------------------------------------------------------------------------

const OWNERSHIP: Record<string, Ownership> = {
  public: "public", listed: "public", pe_backed: "pe_backed", pebacked: "pe_backed", private_equity: "pe_backed", pe: "pe_backed",
  vc_backed: "vc_backed", vcbacked: "vc_backed", vc: "vc_backed", private: "private", non_profit: "non_profit", nonprofit: "non_profit", unknown: "unknown",
};
const SEAT_TYPES: SeatType[] = ["executive", "board", "advisory", "pe_operating_partner", "pe_deal_partner", "other"];
const CONTACT_TYPES = ["prospective_client", "potential_candidate", "referrer", "sponsor_contact"];
const key = (v: string) => v.trim().toLowerCase().replace(/[\s-]+/g, "_");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD.")
  // Round-trip through Date: "2024-02-30" would otherwise roll over to March 1.
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "This is not a real date.");
const country = z.string().regex(/^[A-Za-z]{2}$/, "Use a two-letter country code, for example US.").transform((v) => v.toUpperCase());

export interface TargetRow {
  company: {
    name: string;
    domain: string | null;
    ticker: string | null;
    secCik: string | null;
    ownership: Ownership;
    targetTier: 1 | 2 | 3 | null;
    industry: string | null;
    hqCountry: string | null;
    employeeCount: number | null;
    clientStatus: "client" | "prospect" | "none";
  };
  person: {
    fullName: string;
    title: string;
    seatType: SeatType | undefined;
    email: string | null;
    linkedinUrl: string | null;
    city: string | null;
    country: string | null;
    contactTypes: string[];
    startDate: string | null;
    endDate: string | null;
  } | null;
  sourceUrl: string | null;
  sourceNote: string | null;
}

export interface RowIssue {
  column: string;
  message: string;
}

export function validateTargetRow(raw: Record<string, string>): { row: TargetRow | null; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const v = (k: string) => raw[k]?.trim() ?? "";
  const opt = (k: string) => v(k) || null;
  const check = <T>(k: string, schema: z.ZodType<T>): T | null => {
    const value = v(k);
    if (!value) return null;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      issues.push({ column: k, message: parsed.error.issues[0]?.message ?? "This value is not valid." });
      return null;
    }
    return parsed.data;
  };

  if (!v("company_name")) issues.push({ column: "company_name", message: "Every row needs a company name." });

  const rawDomain = v("company_domain");
  const domain = rawDomain ? normaliseDomain(rawDomain) : null;
  if (rawDomain && !domain) issues.push({ column: "company_domain", message: "This is not a domain, for example example.com." });

  const rawCik = v("company_sec_cik");
  const secCik = rawCik ? normaliseCik(rawCik) : null;
  if (rawCik && !secCik) issues.push({ column: "company_sec_cik", message: "A CIK has up to 10 digits." });

  const rawOwnership = v("company_ownership");
  const ownership = rawOwnership ? OWNERSHIP[key(rawOwnership)] : "unknown";
  if (!ownership) issues.push({ column: "company_ownership", message: "Use public, pe_backed, vc_backed, private, non_profit or unknown." });

  const rawTier = v("company_tier").replace(/^tier\s*/i, "");
  const tier = rawTier ? Number(rawTier) : null;
  if (rawTier && ![1, 2, 3].includes(tier!)) issues.push({ column: "company_tier", message: "Tier is 1, 2 or 3." });

  const rawEmployees = v("company_employee_count").replace(/[,\s]/g, "");
  const employees = rawEmployees ? Number(rawEmployees) : null;
  if (rawEmployees && (!Number.isInteger(employees) || employees! < 0)) issues.push({ column: "company_employee_count", message: "Use a whole number." });

  const rawClient = v("company_client_status");
  const clientStatus = rawClient ? (["client", "prospect", "none"].includes(key(rawClient)) ? (key(rawClient) as "client" | "prospect" | "none") : null) : "prospect";
  if (!clientStatus) issues.push({ column: "company_client_status", message: "Use client, prospect or none." });

  const hqCountry = check("company_hq_country", country);

  // Person fields are optional as a group: a row can be a company on its own.
  const hasPerson = PERSON_KEYS.some((k) => v(k));
  let person: TargetRow["person"] = null;
  if (hasPerson) {
    if (!v("person_full_name")) issues.push({ column: "person_full_name", message: "A row with person details needs the person's full name." });
    if (!v("person_title")) issues.push({ column: "person_title", message: "A row with person details needs a title." });

    const rawEmail = v("person_email");
    const email = rawEmail ? normaliseEmail(rawEmail) : null;
    if (rawEmail && !email) issues.push({ column: "person_email", message: "This is not an email address." });

    const rawLinkedin = v("person_linkedin_url");
    const linkedinUrl = rawLinkedin ? canonicalLinkedinUrl(rawLinkedin) : null;
    if (rawLinkedin && !linkedinUrl) issues.push({ column: "person_linkedin_url", message: "Use a LinkedIn profile URL, for example https://www.linkedin.com/in/name." });

    const rawSeat = v("person_seat_type");
    const seatType = rawSeat ? (SEAT_TYPES.find((s) => s === key(rawSeat)) ?? null) : undefined;
    if (rawSeat && !seatType) issues.push({ column: "person_seat_type", message: `Use one of: ${SEAT_TYPES.join(", ")}.` });

    const contactTypes = v("person_contact_types").split(/[;|]/).map(key).filter(Boolean);
    const unknownType = contactTypes.find((t) => !CONTACT_TYPES.includes(t));
    if (unknownType) issues.push({ column: "person_contact_types", message: `Unknown contact type "${unknownType}". Use ${CONTACT_TYPES.join(", ")}.` });

    const startDate = check("role_start_date", isoDate);
    const endDate = check("role_end_date", isoDate);
    if (startDate && endDate && endDate < startDate) issues.push({ column: "role_end_date", message: "The end date is before the start date." });

    person = {
      fullName: v("person_full_name"),
      title: v("person_title"),
      seatType: seatType ?? undefined,
      email,
      linkedinUrl,
      city: opt("person_city"),
      country: check("person_country", country),
      contactTypes: unknownType ? [] : contactTypes,
      startDate,
      endDate,
    };
  }

  if (issues.length > 0) return { row: null, issues };
  return {
    row: {
      company: {
        name: v("company_name"),
        domain,
        ticker: opt("company_ticker")?.toUpperCase() ?? null,
        secCik,
        ownership: ownership!,
        targetTier: tier as 1 | 2 | 3 | null,
        industry: opt("company_industry"),
        hqCountry,
        employeeCount: employees,
        clientStatus: clientStatus!,
      },
      person,
      sourceUrl: opt("source_url"),
      sourceNote: opt("source_note"),
    },
    issues,
  };
}

/** Maps each known column or alias in the file to its canonical key. */
export function mapHeaders(parsed: ParsedCsv): { mapping: Record<string, string>; unknown: string[]; missing: string[] } {
  const mapping: Record<string, string> = {};
  const unknown: string[] = [];
  for (const header of parsed.headers) {
    if (!header) continue;
    const column = TARGET_LIST_COLUMNS.find((c) => c.key === header || c.aliases.includes(header));
    if (column && !Object.values(mapping).includes(column.key)) mapping[header] = column.key;
    else if (!column) unknown.push(header);
  }
  const mapped = new Set(Object.values(mapping));
  const missing = TARGET_LIST_COLUMNS.filter((c) => c.required === "always" && !mapped.has(c.key)).map((c) => c.key);
  return { mapping, unknown, missing };
}

// ---------------------------------------------------------------------------------------------
// Preview (read-only) and commit
// ---------------------------------------------------------------------------------------------

export type PersonOutcome = "new" | "matched" | "possible_duplicate" | "suppressed" | "in_file_duplicate";

export interface PreviewRow {
  rowNumber: number;
  raw: Record<string, string>;
  issues: RowIssue[];
  row: TargetRow | null;
  company?: "existing" | "new" | "new_in_file";
  person?: PersonOutcome;
  matchStep?: 1 | 2 | 3;
}

export interface PreviewSummary {
  rows: number;
  valid: number;
  invalid: number;
  companiesNew: number;
  companiesExisting: number;
  peopleNew: number;
  peopleMatched: number;
  possibleDuplicates: number;
  suppressed: number;
  unknownColumns: string[];
}

export class ImportFileError extends Error {}

/** Parses and validates a file. Throws ImportFileError for problems with the file as a whole. */
export function readTargetListFile(text: string): { rows: { rowNumber: number; raw: Record<string, string> }[]; unknownColumns: string[] } {
  if (text.length > MAX_IMPORT_BYTES) throw new ImportFileError("The file is larger than 5 MB. Split it into smaller files.");
  const parsed = parseCsv(text);
  const { mapping, unknown, missing } = mapHeaders(parsed);
  if (missing.length > 0) throw new ImportFileError(`The file needs a ${missing.join(", ")} column. Download the template to see the expected columns.`);
  if (parsed.rows.length === 0) throw new ImportFileError("The file has a header row but no data rows.");
  if (parsed.rows.length > MAX_IMPORT_ROWS) throw new ImportFileError(`The file has ${parsed.rows.length} rows; the limit is ${MAX_IMPORT_ROWS}. Split it into smaller files.`);
  const rows = parsed.rows.map((r, i) => ({
    rowNumber: parsed.rowNumbers[i]!,
    raw: Object.fromEntries(Object.entries(r).flatMap(([h, value]) => (mapping[h] ? [[mapping[h]!, value]] : []))),
  }));
  return { rows, unknownColumns: unknown };
}

/** Classifies every row against the workspace without writing anything. */
export async function previewTargetList(
  tx: Tx,
  workspaceId: string,
  rows: { rowNumber: number; raw: Record<string, string> }[],
  unknownColumns: string[],
): Promise<{ rows: PreviewRow[]; summary: PreviewSummary }> {
  const out: PreviewRow[] = [];
  const companiesInFile = new Map<string, true>();
  const peopleInFile = new Set<string>();

  for (const { rowNumber, raw } of rows) {
    const { row, issues } = validateTargetRow(raw);
    const preview: PreviewRow = { rowNumber, raw, issues, row };
    if (row) {
      const companyKey = row.company.domain ?? row.company.secCik ?? row.company.name.toLowerCase();
      const existingCompany = await resolveCompany(tx, row.company);
      preview.company = existingCompany ? "existing" : companiesInFile.has(companyKey) ? "new_in_file" : "new";
      companiesInFile.set(companyKey, true);

      if (row.person) {
        const personKeys = [row.person.linkedinUrl, row.person.email, `${row.person.fullName.toLowerCase()}|${companyKey}`].filter(Boolean) as string[];
        if (personKeys.some((k) => peopleInFile.has(k))) {
          preview.person = "in_file_duplicate";
        } else if (await isSuppressed(tx, workspaceId, { emails: [row.person.email], linkedinUrls: [row.person.linkedinUrl] })) {
          preview.person = "suppressed";
        } else {
          const match = await matchPerson(tx, {
            fullName: row.person.fullName,
            linkedinUrl: row.person.linkedinUrl,
            emails: [row.person.email],
            city: row.person.city,
            role: existingCompany ? { companyId: existingCompany, title: row.person.title, effectiveOn: row.person.startDate, endedOn: row.person.endDate } : null,
          });
          preview.person = match.kind === "same" ? "matched" : match.kind;
          if (match.kind === "same") preview.matchStep = match.step;
        }
        personKeys.forEach((k) => peopleInFile.add(k));
      }
    }
    out.push(preview);
  }

  const count = (fn: (r: PreviewRow) => boolean) => out.filter(fn).length;
  return {
    rows: out,
    summary: {
      rows: out.length,
      valid: count((r) => !!r.row),
      invalid: count((r) => !r.row),
      companiesNew: count((r) => r.company === "new"),
      companiesExisting: new Set(out.filter((r) => r.company === "existing").map((r) => r.row!.company.name.toLowerCase())).size,
      peopleNew: count((r) => r.person === "new"),
      peopleMatched: count((r) => r.person === "matched" || r.person === "in_file_duplicate"),
      possibleDuplicates: count((r) => r.person === "possible_duplicate"),
      suppressed: count((r) => r.person === "suppressed"),
      unknownColumns,
    },
  };
}

export interface ImportReport {
  companiesCreated: number;
  companiesMatched: number;
  peopleCreated: number;
  peopleMatched: number;
  possibleDuplicates: number;
  conflicts: number;
  rejected: { rowNumber: number; reason: string }[];
}

/**
 * Commits the valid rows in one transaction. Rows are processed in file order, so a person listed
 * twice is created once and matched the second time.
 */
export async function commitTargetList(tx: Tx, actor: Actor, batchId: string, rows: PreviewRow[], fileSource: SourceNote): Promise<ImportReport> {
  const report: ImportReport = { companiesCreated: 0, companiesMatched: 0, peopleCreated: 0, peopleMatched: 0, possibleDuplicates: 0, conflicts: 0, rejected: [] };
  const conflictsBefore = await countPendingConflicts(tx);
  const seenCompanies = new Set<string>();

  for (const preview of rows) {
    if (!preview.row) {
      report.rejected.push({ rowNumber: preview.rowNumber, reason: preview.issues.map((i) => `${i.column}: ${i.message}`).join(" ") });
      continue;
    }
    const { row } = preview;
    const source: SourceNote = {
      sourceType: fileSource.sourceType,
      sourceUrl: row.sourceUrl ?? fileSource.sourceUrl ?? null,
      note: row.sourceNote ?? fileSource.note ?? null,
    };
    const { companyId, created } = await findOrCreateCompany(tx, actor, row.company, source);
    if (created) report.companiesCreated++;
    else if (!seenCompanies.has(companyId)) report.companiesMatched++;
    seenCompanies.add(companyId);

    if (!row.person) continue;
    try {
      const result = await upsertPerson(
        tx,
        actor,
        { fullName: row.person.fullName, linkedinUrl: row.person.linkedinUrl, city: row.person.city, country: row.person.country, contactTypes: row.person.contactTypes, relationshipOwnerId: null },
        [{ companyId, title: row.person.title, seatType: row.person.seatType, businessEmail: row.person.email, effectiveOn: row.person.startDate, endedOn: row.person.endDate }],
        source,
        { addRolesToMatch: true, importBatchId: batchId },
      );
      if (result.outcome === "matched") report.peopleMatched++;
      else {
        report.peopleCreated++;
        if (result.possibleDuplicateOf) report.possibleDuplicates++;
      }
    } catch (error) {
      if (error instanceof SuppressedError) report.rejected.push({ rowNumber: preview.rowNumber, reason: "This person is on the suppression list." });
      else throw error;
    }
  }
  report.conflicts = (await countPendingConflicts(tx)) - conflictsBefore;
  return report;
}

async function countPendingConflicts(tx: Tx): Promise<number> {
  const [row] = await tx.select({ n: count() }).from(queueItems).where(and(eq(queueItems.kind, "data_conflict"), eq(queueItems.status, "pending")));
  return row?.n ?? 0;
}
