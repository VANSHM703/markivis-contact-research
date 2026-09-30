/**
 * Pre-action checks (BRD 12.2), run in order when an action is created, when a draft is written
 * and again at send time (BRD 12.5). The rules are a pure function over loaded facts so they can
 * be unit tested; `loadCheckFacts` gathers the facts inside a workspace transaction.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { consents, offLimits, persons, roles, workspaces } from "@/db/schema";
import { isSuppressed } from "./suppression";
import { SENIORITY_RANK, type Seniority } from "./titles";

/** EU member states, the rest of the EEA (Iceland, Liechtenstein, Norway) and the UK (BRD 12.2 step 3). */
export const EU_EEA_UK = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU",
  "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "GB",
]);

export type ConsentState = "opted_in" | "opted_out" | "legitimate_interest" | "unknown";
export type Channel = "email" | "linkedin_message";
export type Purpose = "client" | "candidate";

export interface OffLimitsRule {
  scope: "company" | "function" | "level_and_above";
  function: string | null;
  minSeniority: Seniority | null;
  startsOn: string;
  endsOn: string | null;
  companyName: string;
}

export interface CheckFacts {
  status: "active" | "no_current_role" | "do_not_contact";
  suppressed: boolean;
  country: string | null;
  contactTypes: string[];
  emailConsent: ConsentState;
  linkedinConsent: ConsentState;
  hasVerifiedEmail: boolean;
  /** Current executive roles, with the rules active on their companies (empty when the pack is off). */
  employment: { function: string | null; seniority: Seniority; rules: OffLimitsRule[] }[];
}

export type CheckResult =
  | { kind: "no_action"; reason: "do_not_contact" | "suppressed" }
  | { kind: "blocked"; reason: "lawful_basis" | "off_limits" | "opted_out"; note: string }
  | { kind: "ok"; channel: Channel; emailAllowed: boolean; linkedinAllowed: boolean };

export const BLOCK_NOTES = {
  lawful_basis: "Record a lawful basis before contacting this person.",
  opted_out: "This person has opted out of email and LinkedIn contact, so no message can be drafted.",
  off_limits: (company: string) => `${company} is off-limits for candidate approaches. A client check-in is still allowed.`,
} as const;

export const isEuEeaUk = (country: string | null) => !!country && EU_EEA_UK.has(country.toUpperCase());

/** A candidate approach (BRD 12.2 step 4): the chosen purpose, or a person known only as a candidate. */
export function isCandidateApproach(purpose: Purpose, contactTypes: string[]): boolean {
  return purpose === "candidate" || (contactTypes.length > 0 && contactTypes.every((t) => t === "potential_candidate"));
}

export function ruleActive(rule: Pick<OffLimitsRule, "startsOn" | "endsOn">, today: string): boolean {
  return rule.startsOn <= today && (rule.endsOn === null || rule.endsOn >= today);
}

export function ruleCovers(rule: OffLimitsRule, role: { function: string | null; seniority: Seniority }): boolean {
  if (rule.scope === "company") return true;
  if (rule.scope === "function") return !!rule.function && !!role.function && rule.function.toLowerCase() === role.function.toLowerCase();
  return !!rule.minSeniority && SENIORITY_RANK[role.seniority] >= SENIORITY_RANK[rule.minSeniority];
}

/** The first failing check, or the channel to draft in. `preferred` is honoured when it is allowed. */
export function evaluateChecks(facts: CheckFacts, purpose: Purpose, today: string, preferred?: Channel): CheckResult {
  // Step 1: do not contact, or suppressed.
  if (facts.status === "do_not_contact") return { kind: "no_action", reason: "do_not_contact" };
  if (facts.suppressed) return { kind: "no_action", reason: "suppressed" };

  // Step 2: opt-outs remove a channel; with both gone nothing can be drafted.
  const emailAllowed = facts.emailConsent !== "opted_out";
  const linkedinAllowed = facts.linkedinConsent !== "opted_out";
  if (!emailAllowed && !linkedinAllowed) return { kind: "blocked", reason: "opted_out", note: BLOCK_NOTES.opted_out };

  // Step 3: EU, EEA or UK with no recorded basis for email.
  if (emailAllowed && isEuEeaUk(facts.country) && facts.emailConsent === "unknown") {
    return { kind: "blocked", reason: "lawful_basis", note: BLOCK_NOTES.lawful_basis };
  }

  // Step 4: off-limits, for candidate approaches only.
  if (isCandidateApproach(purpose, facts.contactTypes)) {
    for (const job of facts.employment) {
      const rule = job.rules.find((r) => ruleActive(r, today) && ruleCovers(r, job));
      if (rule) return { kind: "blocked", reason: "off_limits", note: BLOCK_NOTES.off_limits(rule.companyName) };
    }
  }

  let channel: Channel;
  if (preferred === "email" && emailAllowed) channel = "email";
  else if (preferred === "linkedin_message" && linkedinAllowed) channel = "linkedin_message";
  else if (emailAllowed && facts.hasVerifiedEmail) channel = "email";
  else if (linkedinAllowed) channel = "linkedin_message";
  else channel = "email";
  return { kind: "ok", channel, emailAllowed, linkedinAllowed };
}

export async function loadCheckFacts(tx: Tx, workspaceId: string, personId: string): Promise<CheckFacts | null> {
  const [person] = await tx.select().from(persons).where(eq(persons.id, personId)).limit(1);
  if (!person) return null;
  const [ws] = await tx.select({ packs: workspaces.packs, flags: workspaces.flags }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const packOn = (ws?.packs as Record<string, boolean> | undefined)?.exec_search !== false && (ws?.flags as Record<string, boolean> | undefined)?.["pack.exec_search"] !== false;

  const personRoles = await tx
    .select({ companyId: roles.companyId, function: roles.function, seniority: roles.seniority, seatType: roles.seatType, status: roles.status, email: roles.businessEmail, emailStatus: roles.emailStatus })
    .from(roles)
    .where(eq(roles.personId, personId));
  const consentRows = await tx
    .select({ channel: consents.channel, status: consents.status })
    .from(consents)
    .where(and(eq(consents.personId, personId), eq(consents.purpose, "outreach")));
  const consentOf = (c: "email" | "linkedin"): ConsentState => consentRows.find((r) => r.channel === c)?.status ?? "unknown";

  const current = personRoles.filter((r) => r.status === "current" && r.seatType !== "board" && r.seatType !== "advisory");
  const employment: CheckFacts["employment"] = [];
  for (const job of current) {
    const rules = packOn
      ? await tx
          .select({ scope: offLimits.scope, function: offLimits.function, minSeniority: offLimits.minSeniority, startsOn: offLimits.startsOn, endsOn: offLimits.endsOn, companyName: sql<string>`(select name from dmi.companies c where c.id = ${offLimits.companyId})` })
          .from(offLimits)
          .where(eq(offLimits.companyId, job.companyId))
      : [];
    employment.push({ function: job.function, seniority: job.seniority, rules });
  }

  return {
    status: person.status,
    suppressed: await isSuppressed(tx, workspaceId, { emails: personRoles.map((r) => r.email), linkedinUrls: [person.linkedinUrl] }),
    country: person.country,
    contactTypes: person.contactTypes,
    emailConsent: consentOf("email"),
    linkedinConsent: consentOf("linkedin"),
    hasVerifiedEmail: personRoles.some((r) => r.status === "current" && r.email && r.emailStatus === "verified"),
    employment,
  };
}
