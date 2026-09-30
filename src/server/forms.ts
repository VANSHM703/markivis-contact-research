/** Form parsing shared by the record server actions. */
import { z } from "zod";
import type { FormState } from "@/components/forms/FormState";
import { canonicalLinkedinUrl, normaliseDomain, normaliseEmail } from "@/lib/normalise";

export const SOURCE_TYPES = [
  { value: "manual", label: "I know this directly" },
  { value: "leadership_page", label: "Company leadership or board page" },
  { value: "press_wire", label: "Press release" },
  { value: "sec_8k", label: "SEC filing" },
  { value: "event_site", label: "Event website" },
  { value: "google_alert", label: "News or alert" },
  { value: "apollo", label: "Apollo" },
] as const;
export type FormSourceType = (typeof SOURCE_TYPES)[number]["value"];

export const CONTACT_TYPE_OPTIONS = [
  { value: "prospective_client", label: "Prospective client" },
  { value: "potential_candidate", label: "Potential candidate" },
  { value: "referrer", label: "Referrer" },
  { value: "sponsor_contact", label: "Sponsor contact" },
];

export const SEAT_TYPE_OPTIONS = [
  { value: "", label: "Work it out from the title" },
  { value: "executive", label: "Executive" },
  { value: "board", label: "Board" },
  { value: "advisory", label: "Advisory" },
  { value: "pe_operating_partner", label: "PE operating partner" },
  { value: "pe_deal_partner", label: "PE deal partner" },
  { value: "other", label: "Other" },
];

export const OWNERSHIP_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "public", label: "Public" },
  { value: "pe_backed", label: "PE-backed" },
  { value: "vc_backed", label: "VC-backed" },
  { value: "private", label: "Private" },
  { value: "non_profit", label: "Non-profit" },
];

export const TIER_OPTIONS = [
  { value: "", label: "Not a target" },
  { value: "1", label: "Tier 1" },
  { value: "2", label: "Tier 2" },
  { value: "3", label: "Tier 3" },
];

export const CLIENT_STATUS_OPTIONS = [
  { value: "prospect", label: "Prospect" },
  { value: "client", label: "Client" },
  { value: "none", label: "None" },
];

const text = (max = 200) => z.string().trim().max(max, `Keep this under ${max} characters.`);
const optionalText = (max = 200) => text(max).transform((v) => v || null);
const isoDate = z
  .string()
  .trim()
  .refine((v) => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v), "Enter a real date.")
  .transform((v) => v || null);
const country = z
  .string()
  .trim()
  .refine((v) => !v || /^[A-Za-z]{2}$/.test(v), "Use a two-letter country code, for example US.")
  .transform((v) => v.toUpperCase() || null);

export const sourceSchema = z.object({
  source_type: z.enum(SOURCE_TYPES.map((s) => s.value) as [FormSourceType, ...FormSourceType[]], { message: "Choose where this came from." }),
  source_note: text(500).min(1, "Say how you know this, so others can check it."),
  source_url: z
    .string()
    .trim()
    .refine((v) => !v || /^https?:\/\/\S+$/.test(v), "Enter a full web address, starting with https://.")
    .transform((v) => v || null),
});

export const personSchema = z.object({
  full_name: text().min(1, "Enter the person's full name."),
  preferred_name: optionalText(),
  linkedin_url: z
    .string()
    .trim()
    .refine((v) => !v || canonicalLinkedinUrl(v) !== null, "Use a LinkedIn profile address, for example https://www.linkedin.com/in/name.")
    .transform((v) => canonicalLinkedinUrl(v)),
  city: optionalText(100),
  region: optionalText(100),
  country,
  contact_types: z.array(z.enum(["prospective_client", "potential_candidate", "referrer", "sponsor_contact"])).default([]),
  is_priority: z.boolean().default(false),
});

export const roleSchema = z.object({
  company_id: z.string().uuid().or(z.literal("")),
  company_new: optionalText(),
  title: text().min(1, "Enter the title as published."),
  seat_type: z.enum(["", "executive", "board", "advisory", "pe_operating_partner", "pe_deal_partner", "other"]).transform((v) => v || undefined),
  business_email: z
    .string()
    .trim()
    .refine((v) => !v || normaliseEmail(v) !== null, "Enter an email address.")
    .transform((v) => normaliseEmail(v)),
  effective_on: isoDate,
  ended_on: isoDate,
});

export const companySchema = z.object({
  name: text().min(1, "Enter the company name."),
  domain: z
    .string()
    .trim()
    .refine((v) => !v || normaliseDomain(v) !== null, "Enter a domain, for example example.com.")
    .transform((v) => normaliseDomain(v)),
  ticker: optionalText(12),
  sec_cik: z
    .string()
    .trim()
    .refine((v) => !v || /^\d{1,10}$/.test(v), "A CIK has up to 10 digits.")
    .transform((v) => v || null),
  ownership: z.enum(["public", "pe_backed", "vc_backed", "private", "non_profit", "unknown"]),
  target_tier: z.enum(["", "1", "2", "3"]).transform((v) => (v ? (Number(v) as 1 | 2 | 3) : null)),
  industry: optionalText(100),
  hq_country: country,
  employee_count: z
    .string()
    .trim()
    .refine((v) => !v || /^\d+$/.test(v.replace(/,/g, "")), "Use a whole number.")
    .transform((v) => (v ? Number(v.replace(/,/g, "")) : null)),
  client_status: z.enum(["client", "prospect", "none"]),
  is_sponsor: z.boolean().default(false),
  leadership_page_urls: z
    .string()
    .transform((v) => v.split(/\s+/).map((u) => u.trim()).filter(Boolean))
    .refine((urls) => urls.every((u) => /^https?:\/\/\S+$/.test(u)), "Each address must start with https://.")
    .refine((urls) => urls.length <= 5, "Add at most five pages."),
});

/** Reads a FormData into a plain object: repeated keys become arrays, checkboxes become booleans. */
export function formObject(formData: FormData, options: { arrays?: string[]; booleans?: string[] } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const all = formData.getAll(key).map((v) => (typeof v === "string" ? v : ""));
    out[key] = options.arrays?.includes(key) ? all : (all[0] ?? "");
  }
  for (const key of options.arrays ?? []) out[key] ??= [];
  for (const key of options.booleans ?? []) out[key] = formData.get(key) === "on" || formData.get(key) === "true";
  return out;
}

/**
 * Parses a form against a schema. A field the schema knows but the form did not send (an
 * optional field a particular form leaves out) is treated as blank rather than invalid.
 */
export function parseForm<T extends z.ZodObject>(schema: T, raw: Record<string, unknown>) {
  const filled: Record<string, unknown> = { ...raw };
  for (const key of Object.keys(schema.shape)) filled[key] ??= "";
  return schema.safeParse(filled);
}

const FIELD_NAMES: Record<string, string> = { leadership_page_urls: "leadership pages", linkedin_url: "LinkedIn profile", business_email: "business email", effective_on: "start date", ended_on: "end date", source_note: "note", source_url: "link", sec_cik: "SEC CIK", hq_country: "headquarters country", target_tier: "target tier" };

/** Turns Zod issues into one message per field, keeping the submitted values for re-display. */
export function invalid(error: z.ZodError, raw: Record<string, unknown>): FormState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  // Name the fields, so a problem is never only a colour or only on a field off screen.
  const names = Object.keys(fieldErrors).map((k) => FIELD_NAMES[k] ?? k.replace(/_/g, " "));
  return {
    message: `Check ${names.length === 1 ? "this field" : "these fields"}: ${names.join(", ")}.`,
    fieldErrors,
    values: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : String(v ?? "")])),
  };
}

/** Every problem from several schemas at once, so one submission shows them all. */
export function invalidAll(results: { success: boolean; error?: z.ZodError }[], raw: Record<string, unknown>, extra: Record<string, string> = {}): FormState | null {
  const issues = results.flatMap((r) => (r.success || !r.error ? [] : r.error.issues));
  const extraIssues = Object.entries(extra).map(([key, message]) => ({ code: "custom" as const, path: [key], message, input: undefined }));
  if (issues.length + extraIssues.length === 0) return null;
  return invalid(new z.ZodError([...issues, ...extraIssues]), raw);
}
