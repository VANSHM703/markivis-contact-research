/** Apollo response mapping (BRD 8.1). Pure. Field names from docs.apollo.io, read 2026-09-30. */
import { normaliseCompanyName, normaliseDomain, normaliseEmail } from "@/lib/normalise";
import { normaliseTitle } from "@/domain/titles";

export interface ApolloOrganization {
  id?: string;
  name?: string;
  primary_domain?: string | null;
  website_url?: string | null;
  estimated_num_employees?: number | null;
  industry?: string | null;
  country?: string | null;
}

export interface ApolloPerson {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string | null;
  email?: string | null;
  email_status?: string | null;
  linkedin_url?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  organization?: ApolloOrganization | null;
  employment_history?: { organization_name?: string; title?: string; start_date?: string | null; end_date?: string | null; current?: boolean }[];
}

export type EmailStatus = "verified" | "guessed" | "invalid" | "unknown";

/**
 * Apollo's email_status to ours. Only "verified" is used for sending; anything Apollo inferred
 * is stored as guessed and never sent to until verified (BRD 8.1).
 */
export function mapEmailStatus(status: string | null | undefined, hasEmail: boolean): EmailStatus {
  if (!hasEmail) return "unknown";
  const s = (status ?? "").toLowerCase();
  if (s === "verified") return "verified";
  if (["bounced", "invalid"].includes(s)) return "invalid";
  return "guessed";
}

export interface CurrentRole {
  companyName: string;
  companyDomain: string | null;
  title: string;
}

export interface JobChange {
  previous: CurrentRole;
  current: { organizationName: string; organizationDomain: string | null; apolloOrgId: string | null; title: string };
  kind: "employer" | "title";
}

/**
 * Compares Apollo's current employer and title with our primary role (BRD 8.1, weekly diff when
 * the plan has no job-change feature). A new employer is compared by domain, then by name.
 */
export function detectJobChange(role: CurrentRole, person: ApolloPerson): JobChange | null {
  const org = person.organization;
  const title = person.title?.trim();
  if (!org?.name || !title) return null;
  const apolloDomain = normaliseDomain(org.primary_domain ?? org.website_url ?? null);
  const sameEmployer =
    (apolloDomain && role.companyDomain && apolloDomain === role.companyDomain) || normaliseCompanyName(org.name) === normaliseCompanyName(role.companyName);
  const current = { organizationName: org.name, organizationDomain: apolloDomain, apolloOrgId: org.id ?? null, title };
  if (!sameEmployer) return { previous: role, current, kind: "employer" };
  if (normaliseTitle(title).titleNormalised !== normaliseTitle(role.title).titleNormalised) return { previous: role, current, kind: "title" };
  return null;
}

/** Lines up bulk results with requests: by position when the counts match, otherwise by email or LinkedIn URL. */
export function alignMatches<T extends { email?: string | null; linkedin_url?: string | null }>(requests: T[], matches: (ApolloPerson | null)[]): (ApolloPerson | null)[] {
  if (matches.length === requests.length) return matches;
  return requests.map((r) => {
    const email = normaliseEmail(r.email);
    return (
      matches.find((m) => m && ((email && normaliseEmail(m.email) === email) || (r.linkedin_url && m.linkedin_url && m.linkedin_url.toLowerCase().includes(r.linkedin_url.toLowerCase().replace(/^https?:\/\/(www\.)?/, ""))))) ?? null
    );
  });
}
