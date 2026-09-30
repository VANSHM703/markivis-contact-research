/**
 * Executive search pack imports (BRD 13, 16.4): placements and off-limits rules. The same flow
 * as the target list: parse and validate, preview with row-level errors and no writes, then commit
 * in one transaction with a report. Placements match people by BRD 7.2 and create the person (with
 * the placed role) when there is no match; off-limits rows must name a company already on the list.
 */
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { placements } from "@/db/schema";
import { canonicalLinkedinUrl, normaliseDomain, normaliseEmail } from "@/lib/normalise";
import type { WorkspaceRole } from "@/config/navigation";
import { matchPerson, resolveCompany } from "../matching";
import { addOffLimitsRule, offLimitsSchema, REASONS, SCOPES, SENIORITIES } from "../off-limits";
import { addPlacement } from "../placements";
import { findOrCreateCompany, upsertPerson, type SourceNote } from "../records";
import { isSuppressed, SuppressedError } from "../suppression";
import { parseCsv } from "./csv";
import { ImportFileError, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, type ColumnSpec, type RowIssue } from "./target-list";

export type PackImportKind = "placements" | "off_limits";

/** Where each import's upload and preview pages live. */
export const IMPORT_PATH: Record<PackImportKind, string> = { placements: "/people/placements/import", off_limits: "/settings/off-limits/import" };

export const PACK_COLUMNS: Record<PackImportKind, ColumnSpec[]> = {
  placements: [
    { key: "person_full_name", aliases: ["full_name", "name", "person_name"], required: "always", description: "Full name of the placed executive", example: "Jordan Example" },
    { key: "company_name", aliases: ["company"], required: "always", description: "Company they were placed at", example: "Example Holdings, Inc." },
    { key: "role_title", aliases: ["title", "role"], required: "always", description: "The role they were placed in", example: "Chief Financial Officer" },
    { key: "placed_on", aliases: ["placement_date", "date"], required: "always", description: "Placement date, YYYY-MM-DD", example: "2024-03-18" },
    { key: "company_domain", aliases: ["domain", "website"], description: "Company website or domain, to match the company", example: "example.com" },
    { key: "person_email", aliases: ["email", "business_email"], description: "Business email, to match the person", example: "jordan@example.com" },
    { key: "person_linkedin_url", aliases: ["linkedin", "linkedin_url"], description: "LinkedIn profile URL, to match the person", example: "https://www.linkedin.com/in/jordan-example" },
    { key: "search_reference", aliases: ["reference", "search_ref"], description: "Your search or engagement reference", example: "DSP-2024-014" },
  ],
  off_limits: [
    { key: "company_name", aliases: ["company"], required: "always", description: "Company the rule covers, already on the target list", example: "Example Holdings, Inc." },
    { key: "scope", aliases: [], required: "always", description: "company, function or level_and_above", example: "company" },
    { key: "reason", aliases: [], required: "always", description: "current_client, recent_placement or contractual", example: "current_client" },
    { key: "starts_on", aliases: ["start_date"], required: "always", description: "First day the rule applies, YYYY-MM-DD", example: "2026-01-01" },
    { key: "ends_on", aliases: ["end_date"], description: "Last day the rule applies, YYYY-MM-DD; blank for no end", example: "2027-12-31" },
    { key: "function", aliases: [], description: "For scope function: the function, for example Finance", example: "" },
    { key: "min_seniority", aliases: ["seniority"], description: "For scope level_and_above: c_suite, svp or vp", example: "" },
    { key: "company_domain", aliases: ["domain", "website"], description: "Company website or domain, to match the company", example: "example.com" },
  ],
};

export function packTemplate(kind: PackImportKind): string {
  const cols = PACK_COLUMNS[kind];
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [cols.map((c) => c.key).join(","), cols.map((c) => escape(c.example)).join(",")].join("\n") + "\n";
}

export interface PackRawRow {
  rowNumber: number;
  raw: Record<string, string>;
}

export function readPackFile(kind: PackImportKind, text: string): { rows: PackRawRow[]; unknownColumns: string[] } {
  if (text.length > MAX_IMPORT_BYTES) throw new ImportFileError("The file is larger than 5 MB. Split it into smaller files.");
  const parsed = parseCsv(text);
  const cols = PACK_COLUMNS[kind];
  const mapping: Record<string, string> = {};
  const unknown: string[] = [];
  for (const header of parsed.headers) {
    if (!header) continue;
    const col = cols.find((c) => c.key === header || c.aliases.includes(header));
    if (col && !Object.values(mapping).includes(col.key)) mapping[header] = col.key;
    else if (!col) unknown.push(header);
  }
  const missing = cols.filter((c) => c.required === "always" && !Object.values(mapping).includes(c.key)).map((c) => c.key);
  if (missing.length) throw new ImportFileError(`The file needs a ${missing.join(", ")} column. Download the template to see the expected columns.`);
  if (parsed.rows.length === 0) throw new ImportFileError("The file has a header row but no data rows.");
  if (parsed.rows.length > MAX_IMPORT_ROWS) throw new ImportFileError(`The file has ${parsed.rows.length} rows; the limit is ${MAX_IMPORT_ROWS}. Split it into smaller files.`);
  return {
    rows: parsed.rows.map((r, i) => ({ rowNumber: parsed.rowNumbers[i]!, raw: Object.fromEntries(Object.entries(r).flatMap(([h, v]) => (mapping[h] ? [[mapping[h]!, v.trim()]] : []))) })),
    unknownColumns: unknown,
  };
}

export type PackOutcome = "new_person" | "matched" | "possible_duplicate" | "already_recorded" | "suppressed" | "rule";

export interface PackPreviewRow {
  rowNumber: number;
  raw: Record<string, string>;
  issues: RowIssue[];
  outcome?: PackOutcome;
  company?: "existing" | "new";
}

export interface PackPreviewSummary {
  rows: number;
  valid: number;
  invalid: number;
  created: number;
  matched: number;
  possibleDuplicates: number;
  skipped: number;
  unknownColumns: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (v: string) => DATE_RE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const key = (v: string) => v.trim().toLowerCase().replace(/[\s-]+/g, "_");

function validatePlacement(raw: Record<string, string>): RowIssue[] {
  const issues: RowIssue[] = [];
  if (!raw.person_full_name) issues.push({ column: "person_full_name", message: "Every row needs the placed executive's name." });
  if (!raw.company_name) issues.push({ column: "company_name", message: "Every row needs the company." });
  if (!raw.role_title) issues.push({ column: "role_title", message: "Every row needs the role they were placed in." });
  if (!raw.placed_on || !realDate(raw.placed_on)) issues.push({ column: "placed_on", message: "Use a real date in the format YYYY-MM-DD." });
  if (raw.person_email && !normaliseEmail(raw.person_email)) issues.push({ column: "person_email", message: "This is not an email address." });
  if (raw.person_linkedin_url && !canonicalLinkedinUrl(raw.person_linkedin_url)) issues.push({ column: "person_linkedin_url", message: "Use a LinkedIn profile URL, for example https://www.linkedin.com/in/name." });
  if (raw.company_domain && !normaliseDomain(raw.company_domain)) issues.push({ column: "company_domain", message: "This is not a domain, for example example.com." });
  return issues;
}

function offLimitsFields(raw: Record<string, string>, companyId: string) {
  return offLimitsSchema.safeParse({
    companyId,
    scope: key(raw.scope ?? ""),
    function: raw.function || undefined,
    minSeniority: raw.min_seniority ? key(raw.min_seniority) : null,
    reason: key(raw.reason ?? ""),
    startsOn: raw.starts_on,
    endsOn: raw.ends_on || null,
  });
}

const FIELD_COLUMN: Record<string, string> = { companyId: "company_name", scope: "scope", function: "function", minSeniority: "min_seniority", reason: "reason", startsOn: "starts_on", endsOn: "ends_on" };

export async function previewPack(tx: Tx, workspaceId: string, kind: PackImportKind, rows: PackRawRow[], unknownColumns: string[]): Promise<{ rows: PackPreviewRow[]; summary: PackPreviewSummary }> {
  const out: PackPreviewRow[] = [];
  for (const { rowNumber, raw } of rows) {
    const preview: PackPreviewRow = { rowNumber, raw, issues: [] };
    const companyId = await resolveCompany(tx, { name: raw.company_name, domain: raw.company_domain || null });
    if (kind === "off_limits") {
      if (!companyId) preview.issues.push({ column: "company_name", message: "This company is not in the workspace. Add it with the target list first." });
      const parsed = offLimitsFields(raw, companyId ?? "00000000-0000-4000-8000-000000000000");
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const column = FIELD_COLUMN[String(issue.path[0])] ?? String(issue.path[0]);
          const message = column === "scope" ? `Use one of: ${SCOPES.join(", ")}.` : column === "reason" ? `Use one of: ${REASONS.join(", ")}.` : column === "min_seniority" && raw.min_seniority ? `Use one of: ${SENIORITIES.join(", ")}.` : issue.message;
          if (column !== "company_name") preview.issues.push({ column, message });
        }
      }
      if (preview.issues.length === 0) {
        preview.outcome = "rule";
        preview.company = "existing";
      }
    } else {
      preview.issues = validatePlacement(raw);
      if (preview.issues.length === 0) {
        preview.company = companyId ? "existing" : "new";
        const email = normaliseEmail(raw.person_email ?? "");
        const linkedin = canonicalLinkedinUrl(raw.person_linkedin_url ?? "");
        if (await isSuppressed(tx, workspaceId, { emails: [email], linkedinUrls: [linkedin] })) preview.outcome = "suppressed";
        else {
          const match = await matchPerson(tx, { fullName: raw.person_full_name!, linkedinUrl: linkedin, emails: [email], role: companyId ? { companyId, title: raw.role_title!, effectiveOn: raw.placed_on!, endedOn: null } : null });
          if (match.kind === "same" && companyId) {
            const [dupe] = await tx.select({ id: placements.id }).from(placements).where(and(eq(placements.personId, match.personId), eq(placements.companyId, companyId), eq(placements.placedOn, raw.placed_on!))).limit(1);
            preview.outcome = dupe ? "already_recorded" : "matched";
          } else preview.outcome = match.kind === "same" ? "matched" : match.kind === "possible_duplicate" ? "possible_duplicate" : "new_person";
        }
      }
    }
    out.push(preview);
  }
  const n = (fn: (r: PackPreviewRow) => boolean) => out.filter(fn).length;
  return {
    rows: out,
    summary: {
      rows: out.length,
      valid: n((r) => r.issues.length === 0),
      invalid: n((r) => r.issues.length > 0),
      created: n((r) => r.outcome === "new_person" || r.outcome === "possible_duplicate" || r.outcome === "rule"),
      matched: n((r) => r.outcome === "matched"),
      possibleDuplicates: n((r) => r.outcome === "possible_duplicate"),
      skipped: n((r) => r.outcome === "already_recorded" || r.outcome === "suppressed"),
      unknownColumns,
    },
  };
}

export interface PackImportReport {
  placementsCreated: number;
  rulesCreated: number;
  peopleCreated: number;
  peopleMatched: number;
  possibleDuplicates: number;
  skipped: number;
  rejected: { rowNumber: number; reason: string }[];
}

export async function commitPack(tx: Tx, actor: { workspaceId: string; userId: string; role: WorkspaceRole }, kind: PackImportKind, batchId: string, rows: PackPreviewRow[], fileSource: SourceNote): Promise<PackImportReport> {
  const report: PackImportReport = { placementsCreated: 0, rulesCreated: 0, peopleCreated: 0, peopleMatched: 0, possibleDuplicates: 0, skipped: 0, rejected: [] };
  for (const row of rows) {
    if (row.issues.length) {
      report.rejected.push({ rowNumber: row.rowNumber, reason: row.issues.map((i) => `${i.column}: ${i.message}`).join(" ") });
      continue;
    }
    const { raw } = row;
    if (kind === "off_limits") {
      const companyId = await resolveCompany(tx, { name: raw.company_name, domain: raw.company_domain || null });
      const parsed = companyId ? offLimitsFields(raw, companyId) : null;
      if (!parsed?.success) {
        report.rejected.push({ rowNumber: row.rowNumber, reason: "The company or a field changed since the preview. Upload the file again." });
        continue;
      }
      await addOffLimitsRule(tx, actor, parsed.data);
      report.rulesCreated++;
      continue;
    }
    if (row.outcome === "already_recorded" || row.outcome === "suppressed") {
      report.skipped++;
      continue;
    }
    const { companyId } = await findOrCreateCompany(tx, actor, { name: raw.company_name!, domain: normaliseDomain(raw.company_domain ?? "") }, fileSource);
    let personId: string;
    try {
      const result = await upsertPerson(
        tx,
        actor,
        { fullName: raw.person_full_name!, linkedinUrl: raw.person_linkedin_url || null, relationshipOwnerId: actor.userId },
        [{ companyId, title: raw.role_title!, businessEmail: normaliseEmail(raw.person_email ?? ""), effectiveOn: raw.placed_on! }],
        fileSource,
        { importBatchId: batchId },
      );
      personId = result.personId;
      if (result.outcome === "matched") report.peopleMatched++;
      else {
        report.peopleCreated++;
        if (result.possibleDuplicateOf) report.possibleDuplicates++;
      }
    } catch (error) {
      if (error instanceof SuppressedError) {
        report.skipped++;
        continue;
      }
      throw error;
    }
    const [dupe] = await tx.select({ id: placements.id }).from(placements).where(and(eq(placements.personId, personId), eq(placements.companyId, companyId), eq(placements.placedOn, raw.placed_on!))).limit(1);
    if (dupe) {
      report.skipped++;
      continue;
    }
    await addPlacement(tx, actor, { personId, companyId, roleTitle: raw.role_title!, placedOn: raw.placed_on!, searchReference: raw.search_reference || null }, "import");
    report.placementsCreated++;
  }
  return report;
}
