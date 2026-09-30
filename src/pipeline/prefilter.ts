/**
 * Pre-filter (BRD 9.2): a deterministic name and alias match before any AI call. An item passes
 * if it names a tracked company, or names a tracked person together with a tracked company or a
 * leadership term. SEC items for a tracked CIK, leadership page diffs and Apollo changes always
 * pass. The output is the candidate list the extraction step may choose from.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Candidate } from "@/ai/contracts";
import type { Tx } from "@/db/client";
import { companies, persons, roles } from "@/db/schema";

/** Lowercase, accents stripped, punctuation to spaces, padded, so " name " matches whole words. */
export function normaliseText(text: string): string {
  return ` ${text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
}

const LEADERSHIP_TERMS = ["appointed", "appoints", "appoint", "named", "names", "joins", "joined", "resigns", "resigned", "resign", "steps down", "step down", "stepping down", "retire", "retires", "retirement", "board", "chief", "president", "director"];
const LEADERSHIP = LEADERSHIP_TERMS.map((t) => ` ${t} `);

export interface IndexedCompany {
  id: string;
  name: string;
  nameNormalised: string;
  aliases: string[];
  domain: string | null;
  secCik: string | null;
}

export interface IndexedPerson {
  id: string;
  name: string;
  nameNormalised: string;
  companyId: string | null;
  companyName: string | null;
  title: string | null;
}

export interface WorkspaceIndex {
  companies: IndexedCompany[];
  people: IndexedPerson[];
  byCompany: Map<string, IndexedPerson[]>;
}

export async function buildIndex(tx: Tx): Promise<WorkspaceIndex> {
  const cs = await tx.select({ id: companies.id, name: companies.name, nameNormalised: companies.nameNormalised, aliases: companies.aliases, domain: companies.domain, secCik: companies.secCik }).from(companies);
  const ps = await tx
    .select({ id: persons.id, name: persons.fullName, nameNormalised: persons.nameNormalised, companyId: roles.companyId, title: roles.title })
    .from(persons)
    .leftJoin(roles, and(eq(roles.personId, persons.id), eq(roles.isPrimary, true)))
    .where(and(eq(persons.isTracked, true), isNull(persons.mergedIntoId)));
  const name = new Map(cs.map((c) => [c.id, c.name]));
  const people = ps.map((p) => ({ ...p, companyName: p.companyId ? name.get(p.companyId) ?? null : null }));
  // Everyone with a current seat at a company, for candidates when the company is named.
  const seats = await tx.select({ personId: roles.personId, companyId: roles.companyId, title: roles.title }).from(roles).where(inArray(roles.status, ["current", "announced"]));
  const byId = new Map(people.map((p) => [p.id, p]));
  const byCompany = new Map<string, IndexedPerson[]>();
  for (const seat of seats) {
    const p = byId.get(seat.personId);
    if (!p) continue;
    byCompany.set(seat.companyId, [...(byCompany.get(seat.companyId) ?? []), { ...p, companyId: seat.companyId, companyName: name.get(seat.companyId) ?? null, title: seat.title }]);
  }
  return { companies: cs, people, byCompany };
}

export interface PrefilterInput {
  sourceType: string;
  title: string | null;
  bodyText: string | null;
  url: string | null;
  payload: Record<string, unknown> | null;
}

export interface PrefilterResult {
  pass: boolean;
  reason: string;
  companyIds: string[];
  /** People named in the text: the basis of a step-3 match (name plus a role at the company). */
  namedPersonIds: string[];
  /** Companies matched by domain or CIK (BRD 10.1). */
  strongCompanyIds: string[];
  candidates: Candidate[];
}

const MAX_PEOPLE_PER_COMPANY = 25;

export function prefilter(item: PrefilterInput, index: WorkspaceIndex): PrefilterResult {
  const raw = `${item.title ?? ""}\n${item.bodyText ?? ""}`;
  const text = normaliseText(raw);
  const host = (() => {
    try {
      return item.url ? new URL(item.url).hostname.replace(/^www\./, "").toLowerCase() : null;
    } catch {
      return null;
    }
  })();

  const companyIds = new Set<string>();
  const strong = new Set<string>();
  const payloadCompany = typeof item.payload?.company_id === "string" ? item.payload.company_id : null;
  if (payloadCompany && (item.sourceType === "sec_8k" || item.sourceType === "leadership_page")) {
    companyIds.add(payloadCompany);
    strong.add(payloadCompany);
  }
  for (const c of index.companies) {
    const nameHit = c.nameNormalised.length >= 4 && text.includes(` ${c.nameNormalised} `);
    const aliasHit = c.aliases.some((a) => a.length >= 3 && new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(raw));
    const domainHit = !!c.domain && (raw.toLowerCase().includes(c.domain) || host === c.domain || !!host?.endsWith(`.${c.domain}`));
    if (nameHit || aliasHit || domainHit) companyIds.add(c.id);
    if (domainHit && (host === c.domain || !!host?.endsWith(`.${c.domain}`))) strong.add(c.id);
  }

  const named = new Set(index.people.filter((p) => p.nameNormalised.length >= 5 && text.includes(` ${p.nameNormalised} `)).map((p) => p.id));
  const leadershipTerm = LEADERSHIP.some((t) => text.includes(t));
  const payloadPerson = typeof item.payload?.person_id === "string" ? item.payload.person_id : null;
  if (payloadPerson) named.add(payloadPerson);

  let pass: boolean;
  let reason: string;
  if (item.sourceType === "sec_8k" && payloadCompany) [pass, reason] = [true, "SEC filing for a tracked CIK"];
  else if (item.sourceType === "leadership_page" && payloadCompany) [pass, reason] = [true, "Change to a tracked company's leadership page"];
  else if (item.sourceType === "apollo" && payloadPerson) [pass, reason] = [true, "Apollo change for a tracked person"];
  else if (companyIds.size > 0) [pass, reason] = [true, "Names a tracked company"];
  else if (named.size > 0 && leadershipTerm) [pass, reason] = [true, "Names a tracked person with a leadership term"];
  else if (named.size > 0) [pass, reason] = [false, "Names a tracked person, but no tracked company or leadership term"];
  else [pass, reason] = [false, "No tracked company or person named"];

  const candidates: Candidate[] = [];
  if (pass) {
    for (const id of companyIds) {
      const c = index.companies.find((x) => x.id === id)!;
      candidates.push({ id: c.id, kind: "company", name: c.name, aliases: c.aliases });
    }
    const people = new Map<string, Candidate>();
    for (const id of named) {
      const p = index.people.find((x) => x.id === id);
      if (p) people.set(p.id, { id: p.id, kind: "person", name: p.name, company_name: p.companyName, title: p.title });
    }
    for (const id of companyIds) {
      for (const p of (index.byCompany.get(id) ?? []).slice(0, MAX_PEOPLE_PER_COMPANY)) {
        if (!people.has(p.id)) people.set(p.id, { id: p.id, kind: "person", name: p.name, company_name: p.companyName, title: p.title });
      }
    }
    candidates.push(...people.values());
  }
  return { pass, reason, companyIds: [...companyIds], namedPersonIds: [...named], strongCompanyIds: [...strong], candidates };
}
