/**
 * Record changes for people, companies and roles (BRD 6.1, 7.2, 7.3). Every function runs inside
 * the caller's workspace-scoped transaction, records provenance for key fields, and audits.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { companies, persons, queueItems, roles } from "@/db/schema";
import { audit } from "@/lib/audit";
import { canonicalLinkedinUrl, normaliseCik, normaliseCompanyName, normaliseDomain, normaliseEmail, normaliseName } from "@/lib/normalise";
import { matchPerson, resolveCompany, type PersonMatch } from "./matching";
import { observeField, type Confidence, type SourceType } from "./provenance";
import { isSuppressed, SuppressedError } from "./suppression";
import { normaliseTitle, SENIORITY_RANK, type SeatType } from "./titles";

export interface Actor {
  workspaceId: string;
  userId: string | null;
  kind?: "user" | "system";
}

/** Where a manual entry or import came from ("How do you know this?", BRD 16.4). */
export interface SourceNote {
  sourceType: SourceType;
  sourceUrl?: string | null;
  note?: string | null;
  /** Defaults to medium for a manual entry with a source note (BRD 9.4), low without one. */
  confidence?: Confidence;
}

function confidenceOf(source: SourceNote): Confidence {
  if (source.confidence) return source.confidence;
  return source.note?.trim() || source.sourceUrl?.trim() ? "medium" : "low";
}

async function write(tx: Tx, actor: Actor, action: string, entityType: string, entityId: string, before: unknown, after: unknown) {
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: actor.kind ?? "user", action, entityType, entityId, before, after });
}

// ---------------------------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------------------------

export type Ownership = "public" | "pe_backed" | "vc_backed" | "private" | "non_profit" | "unknown";

export interface CompanyInput {
  name: string;
  domain?: string | null;
  secCik?: string | null;
  ticker?: string | null;
  ownership?: Ownership;
  targetTier?: 1 | 2 | 3 | null;
  industry?: string | null;
  hqCountry?: string | null;
  hqRegion?: string | null;
  employeeCount?: number | null;
  clientStatus?: "client" | "prospect" | "none";
  isSponsor?: boolean;
  leadershipPageUrls?: string[];
}

function sizeBandFor(count: number | null | undefined) {
  if (count === null || count === undefined) return "unknown" as const;
  if (count < 200) return "lt_200" as const;
  if (count < 1000) return "200_999" as const;
  if (count < 5000) return "1000_4999" as const;
  return "5000_plus" as const;
}

export async function createCompany(tx: Tx, actor: Actor, input: CompanyInput, source: SourceNote): Promise<string> {
  const domain = normaliseDomain(input.domain);
  const secCik = normaliseCik(input.secCik);
  const values = {
    workspaceId: actor.workspaceId,
    name: input.name.trim(),
    nameNormalised: normaliseCompanyName(input.name),
    aliases: input.ticker ? [input.ticker.trim().toUpperCase()] : [],
    domain,
    secCik,
    ownership: input.ownership ?? "unknown",
    isSponsor: input.isSponsor ?? false,
    hqCountry: input.hqCountry?.toUpperCase() ?? null,
    hqRegion: input.hqRegion ?? null,
    industry: input.industry ?? null,
    employeeCount: input.employeeCount ?? null,
    sizeBand: sizeBandFor(input.employeeCount),
    targetTier: input.targetTier ?? null,
    clientStatus: input.clientStatus ?? "prospect",
    leadershipPageUrls: input.leadershipPageUrls ?? [],
  };
  const [row] = await tx.insert(companies).values(values).returning();
  const confidence = confidenceOf(source);
  for (const [field, value] of [["name", values.name], ["domain", domain], ["sec_cik", secCik]] as const) {
    if (value) await observeField(tx, { workspaceId: actor.workspaceId, entityType: "company", entityId: row!.id, field, value, sourceType: source.sourceType, sourceUrl: source.sourceUrl, confidence });
  }
  await write(tx, actor, "company.created", "company", row!.id, null, { ...values, source_note: source.note ?? null });
  return row!.id;
}

/** Finds the company by the BRD 7.2 keys, or creates it. */
export async function findOrCreateCompany(tx: Tx, actor: Actor, input: CompanyInput, source: SourceNote): Promise<{ companyId: string; created: boolean }> {
  const existing = await resolveCompany(tx, input);
  if (existing) return { companyId: existing, created: false };
  return { companyId: await createCompany(tx, actor, input, source), created: true };
}

export async function updateCompany(tx: Tx, actor: Actor, companyId: string, patch: Partial<CompanyInput>, source: SourceNote): Promise<void> {
  const [before] = await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!before) throw new Error("Company not found.");
  const confidence = confidenceOf(source);
  const set: Partial<typeof companies.$inferInsert> = {};

  const observed = async (field: string, value: string | null) =>
    (await observeField(tx, { workspaceId: actor.workspaceId, entityType: "company", entityId: companyId, field, value, sourceType: source.sourceType, sourceUrl: source.sourceUrl, confidence })).current;

  if (patch.name !== undefined && patch.name.trim() !== before.name) {
    set.name = (await observed("name", patch.name.trim())) ?? before.name;
    set.nameNormalised = normaliseCompanyName(set.name);
  }
  if (patch.domain !== undefined && normaliseDomain(patch.domain) !== before.domain) set.domain = await observed("domain", normaliseDomain(patch.domain));
  if (patch.secCik !== undefined && normaliseCik(patch.secCik) !== before.secCik) set.secCik = await observed("sec_cik", normaliseCik(patch.secCik));
  if (patch.ticker) set.aliases = Array.from(new Set([...before.aliases, patch.ticker.trim().toUpperCase()]));
  if (patch.ownership) set.ownership = patch.ownership;
  if (patch.targetTier !== undefined) set.targetTier = patch.targetTier;
  if (patch.industry !== undefined) set.industry = patch.industry;
  if (patch.hqCountry !== undefined) set.hqCountry = patch.hqCountry?.toUpperCase() ?? null;
  if (patch.employeeCount !== undefined) {
    set.employeeCount = patch.employeeCount;
    set.sizeBand = sizeBandFor(patch.employeeCount);
  }
  if (patch.clientStatus) set.clientStatus = patch.clientStatus;
  if (patch.isSponsor !== undefined) set.isSponsor = patch.isSponsor;
  if (patch.leadershipPageUrls) set.leadershipPageUrls = patch.leadershipPageUrls;
  if (Object.keys(set).length === 0) return;

  await tx.update(companies).set(set).where(eq(companies.id, companyId));
  await write(tx, actor, "company.updated", "company", companyId, pick(before, Object.keys(set)), { ...set, source_note: source.note ?? null });
}

function pick(row: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, row[k]]));
}

// ---------------------------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------------------------

export interface RoleInput {
  companyId: string;
  title: string;
  seatType?: SeatType;
  businessEmail?: string | null;
  emailStatus?: "verified" | "guessed" | "invalid" | "unknown";
  announcedOn?: string | null;
  effectiveOn?: string | null;
  endedOn?: string | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusFor(input: RoleInput): "announced" | "current" | "ended" {
  if (input.endedOn) return "ended";
  if (input.effectiveOn && input.effectiveOn > todayIso()) return "announced";
  return "current";
}

export async function addRole(tx: Tx, actor: Actor, personId: string, input: RoleInput, source: SourceNote): Promise<{ roleId: string; created: boolean }> {
  const title = normaliseTitle(input.title);
  const effectiveOn = input.effectiveOn || null;

  // The unique key (person, company, normalised title, effective date) means "the same seat".
  const existing = await tx
    .select()
    .from(roles)
    .where(and(eq(roles.personId, personId), eq(roles.companyId, input.companyId), eq(roles.titleNormalised, title.titleNormalised)));
  const same = existing.find((r) => (r.effectiveOn ?? null) === effectiveOn || (!effectiveOn && r.status !== "ended"));
  const email = normaliseEmail(input.businessEmail);
  const confidence = confidenceOf(source);

  if (same) {
    if (email && email !== same.businessEmail) {
      const result = await observeField(tx, { workspaceId: actor.workspaceId, entityType: "role", entityId: same.id, field: "business_email", value: email, sourceType: source.sourceType, sourceUrl: source.sourceUrl, confidence });
      if (result.current !== same.businessEmail) {
        await tx.update(roles).set({ businessEmail: result.current, emailStatus: input.emailStatus ?? "unknown" }).where(eq(roles.id, same.id));
      }
    }
    return { roleId: same.id, created: false };
  }

  const values = {
    workspaceId: actor.workspaceId,
    personId,
    companyId: input.companyId,
    seatType: input.seatType ?? title.seatType,
    title: input.title.trim(),
    titleNormalised: title.titleNormalised,
    function: title.function,
    seniority: title.seniority,
    businessEmail: email,
    emailStatus: email ? (input.emailStatus ?? "unknown") : ("unknown" as const),
    announcedOn: input.announcedOn || null,
    effectiveOn,
    endedOn: input.endedOn || null,
    status: statusFor(input),
  };
  const [row] = await tx.insert(roles).values(values).returning({ id: roles.id });
  await observeField(tx, { workspaceId: actor.workspaceId, entityType: "role", entityId: row!.id, field: "title", value: values.title, sourceType: source.sourceType, sourceUrl: source.sourceUrl, confidence });
  if (email) await observeField(tx, { workspaceId: actor.workspaceId, entityType: "role", entityId: row!.id, field: "business_email", value: email, sourceType: source.sourceType, sourceUrl: source.sourceUrl, confidence });
  await recomputePrimaryRole(tx, personId);
  await write(tx, actor, "role.created", "role", row!.id, null, { ...values, source_note: source.note ?? null });
  return { roleId: row!.id, created: true };
}

/** Days after a person's last role ends before their status becomes no_current_role (BRD 7.3). */
export const NO_CURRENT_ROLE_AFTER_DAYS = 90;

/**
 * Ends a role (BRD 7.3 "Leaves an executive role" and "Joins or leaves a board"). The person stays
 * active while any other role is current; with none, they become no_current_role 90 days after
 * the end date. Other roles are never touched, so concurrent board seats survive.
 */
export async function endRole(tx: Tx, actor: Actor, roleId: string, endedOn: string, source: SourceNote): Promise<void> {
  const [before] = await tx.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!before) throw new Error("Role not found.");
  if (before.status === "ended") return;
  await tx.update(roles).set({ status: "ended", endedOn, isPrimary: false }).where(eq(roles.id, roleId));
  await observeField(tx, { workspaceId: actor.workspaceId, entityType: "role", entityId: roleId, field: "ended_on", value: endedOn, sourceType: source.sourceType, sourceUrl: source.sourceUrl, confidence: confidenceOf(source) });
  await recomputePrimaryRole(tx, before.personId);
  await refreshPersonStatus(tx, before.personId);
  await write(tx, actor, "role.ended", "role", roleId, { status: before.status, endedOn: before.endedOn }, { status: "ended", endedOn, source_note: source.note ?? null });
}

/** Applies BRD 7.3 to the person's status after a role change. Never overrides do_not_contact. */
export async function refreshPersonStatus(tx: Tx, personId: string, today = todayIso()): Promise<void> {
  const [person] = await tx.select({ status: persons.status }).from(persons).where(eq(persons.id, personId)).limit(1);
  if (!person || person.status === "do_not_contact") return;
  const all = await tx.select({ status: roles.status, endedOn: roles.endedOn }).from(roles).where(eq(roles.personId, personId));
  const live = all.some((r) => r.status === "current" || r.status === "announced");
  let status: "active" | "no_current_role" = "active";
  if (!live && all.length > 0) {
    const lastEnd = all.map((r) => r.endedOn ?? "0000-01-01").sort().at(-1)!;
    const cutoff = new Date(`${today}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - NO_CURRENT_ROLE_AFTER_DAYS);
    if (lastEnd <= cutoff.toISOString().slice(0, 10)) status = "no_current_role";
  }
  if (status !== person.status) await tx.update(persons).set({ status }).where(eq(persons.id, personId));
}

/**
 * Primary role rule (BRD 7.3): the current executive role with the most senior seniority (ties go
 * to the most recent start); if none, the most recent current board role.
 */
export async function recomputePrimaryRole(tx: Tx, personId: string): Promise<string | null> {
  const all = await tx.select().from(roles).where(eq(roles.personId, personId));
  const current = all.filter((r) => r.status === "current");
  const byRecent = (a: (typeof all)[number], b: (typeof all)[number]) => (b.effectiveOn ?? "").localeCompare(a.effectiveOn ?? "");
  const executive = current.filter((r) => r.seatType !== "board").sort((a, b) => SENIORITY_RANK[b.seniority] - SENIORITY_RANK[a.seniority] || byRecent(a, b));
  const board = current.filter((r) => r.seatType === "board").sort(byRecent);
  const primary = executive[0] ?? board[0] ?? null;

  const wrong = all.filter((r) => r.isPrimary && r.id !== primary?.id).map((r) => r.id);
  if (wrong.length > 0) await tx.update(roles).set({ isPrimary: false }).where(inArray(roles.id, wrong));
  if (primary && !primary.isPrimary) await tx.update(roles).set({ isPrimary: true }).where(eq(roles.id, primary.id));
  return primary?.id ?? null;
}

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------

export interface PersonInput {
  fullName: string;
  preferredName?: string | null;
  linkedinUrl?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  contactTypes?: string[];
  relationshipOwnerId?: string | null;
  isPriority?: boolean;
}

export type PersonUpsertResult =
  | { outcome: "created"; personId: string; possibleDuplicateOf?: string[] }
  | { outcome: "matched"; personId: string; step: 1 | 2 | 3 };

/**
 * Adds a person with their roles, applying the matching order in BRD 7.2 and the suppression
 * check first. A step 1 to 3 match returns the existing person (with any new roles added when
 * `addRolesToMatch` is set, as imports do). A step 4 match creates the person and a
 * possible_duplicate queue item; it never merges.
 */
export async function upsertPerson(
  tx: Tx,
  actor: Actor,
  input: PersonInput,
  roleInputs: RoleInput[],
  source: SourceNote,
  options: { addRolesToMatch?: boolean; importBatchId?: string } = {},
): Promise<PersonUpsertResult> {
  const linkedinUrl = canonicalLinkedinUrl(input.linkedinUrl);
  const emails = roleInputs.map((r) => r.businessEmail);
  if (await isSuppressed(tx, actor.workspaceId, { emails, linkedinUrls: [linkedinUrl] })) throw new SuppressedError();

  const firstRole = roleInputs[0];
  const match: PersonMatch = await matchPerson(tx, {
    fullName: input.fullName,
    linkedinUrl,
    emails,
    city: input.city,
    role: firstRole ? { companyId: firstRole.companyId, title: firstRole.title, effectiveOn: firstRole.effectiveOn, endedOn: firstRole.endedOn } : null,
  });

  if (match.kind === "same") {
    if (options.addRolesToMatch) {
      for (const role of roleInputs) await addRole(tx, actor, match.personId, role, source);
      await fillPersonFields(tx, actor, match.personId, { ...input, linkedinUrl }, source);
    }
    await write(tx, actor, "person.matched", "person", match.personId, null, { step: match.step, input_name: input.fullName, import_batch_id: options.importBatchId ?? null });
    return { outcome: "matched", personId: match.personId, step: match.step };
  }

  const values = {
    workspaceId: actor.workspaceId,
    fullName: input.fullName.trim(),
    preferredName: input.preferredName?.trim() || null,
    nameNormalised: normaliseName(input.fullName),
    linkedinUrl,
    city: input.city?.trim() || null,
    region: input.region?.trim() || null,
    country: input.country?.trim().toUpperCase() || null,
    contactTypes: input.contactTypes ?? [],
    relationshipOwnerId: input.relationshipOwnerId ?? null,
    isPriority: input.isPriority ?? false,
  };
  const [person] = await tx.insert(persons).values(values).returning({ id: persons.id });
  const personId = person!.id;
  const confidence = confidenceOf(source);
  for (const [field, value] of [["full_name", values.fullName], ["linkedin_url", linkedinUrl], ["city", values.city], ["country", values.country]] as const) {
    if (value) await observeField(tx, { workspaceId: actor.workspaceId, entityType: "person", entityId: personId, field, value, sourceType: source.sourceType, sourceUrl: source.sourceUrl, confidence });
  }
  for (const role of roleInputs) await addRole(tx, actor, personId, role, source);
  await write(tx, actor, "person.created", "person", personId, null, { ...values, source_note: source.note ?? null, import_batch_id: options.importBatchId ?? null });

  if (match.kind === "possible_duplicate") {
    await tx.insert(queueItems).values({
      workspaceId: actor.workspaceId,
      kind: "possible_duplicate",
      payload: { person_ids: [personId, ...match.candidateIds], reason: "same_name_and_company_or_city", import_batch_id: options.importBatchId ?? null },
    });
    return { outcome: "created", personId, possibleDuplicateOf: match.candidateIds };
  }
  return { outcome: "created", personId };
}

/** Sets person fields from a new observation, through provenance, so disagreements become conflicts. */
async function fillPersonFields(tx: Tx, actor: Actor, personId: string, input: PersonInput, source: SourceNote): Promise<void> {
  const [before] = await tx.select().from(persons).where(eq(persons.id, personId)).limit(1);
  if (!before) return;
  const confidence = confidenceOf(source);
  const set: Partial<typeof persons.$inferInsert> = {};
  const fields: [keyof typeof before, string, string | null][] = [
    ["linkedinUrl", "linkedin_url", canonicalLinkedinUrl(input.linkedinUrl)],
    ["city", "city", input.city?.trim() || null],
    ["country", "country", input.country?.trim().toUpperCase() || null],
  ];
  for (const [key, field, value] of fields) {
    if (!value || value === before[key]) continue;
    if (key === "linkedinUrl") {
      // Keep the unique LinkedIn URL clean: never set one another person already holds.
      const [taken] = await tx.select({ id: persons.id }).from(persons).where(and(eq(persons.linkedinUrl, value), ne(persons.id, personId))).limit(1);
      if (taken) continue;
    }
    const result = await observeField(tx, { workspaceId: actor.workspaceId, entityType: "person", entityId: personId, field, value, sourceType: source.sourceType, sourceUrl: source.sourceUrl, confidence });
    if (result.current !== before[key]) (set as Record<string, unknown>)[key] = result.current;
  }
  const types = Array.from(new Set([...before.contactTypes, ...(input.contactTypes ?? [])]));
  if (types.length !== before.contactTypes.length) set.contactTypes = types;
  if (Object.keys(set).length === 0) return;
  await tx.update(persons).set(set).where(eq(persons.id, personId));
  await write(tx, actor, "person.updated", "person", personId, pick(before, Object.keys(set)), { ...set, source_note: source.note ?? null });
}

export async function updatePerson(tx: Tx, actor: Actor, personId: string, patch: PersonInput, source: SourceNote): Promise<void> {
  const [before] = await tx.select().from(persons).where(eq(persons.id, personId)).limit(1);
  if (!before) throw new Error("Person not found.");
  const linkedinUrl = patch.linkedinUrl === undefined ? before.linkedinUrl : canonicalLinkedinUrl(patch.linkedinUrl);
  if (linkedinUrl && linkedinUrl !== before.linkedinUrl) {
    if (await isSuppressed(tx, actor.workspaceId, { linkedinUrls: [linkedinUrl] })) throw new SuppressedError();
    const [taken] = await tx.select({ id: persons.id }).from(persons).where(and(eq(persons.linkedinUrl, linkedinUrl), ne(persons.id, personId))).limit(1);
    if (taken) throw new DuplicateLinkedinError(taken.id);
  }
  const set: Partial<typeof persons.$inferInsert> = {};
  const track = async (key: "fullName" | "linkedinUrl" | "city" | "country", field: string, value: string | null) => {
    if (value === before[key]) return;
    // A person editing the record directly is the authority: the edit is shown, and provenance
    // keeps the previous value and its source.
    await observeField(tx, { workspaceId: actor.workspaceId, entityType: "person", entityId: personId, field, value, sourceType: source.sourceType, sourceUrl: source.sourceUrl, confidence: "high" });
    (set as Record<string, unknown>)[key] = value;
  };
  await track("fullName", "full_name", patch.fullName.trim());
  if (set.fullName) set.nameNormalised = normaliseName(set.fullName);
  await track("linkedinUrl", "linkedin_url", linkedinUrl ?? null);
  await track("city", "city", patch.city?.trim() || null);
  await track("country", "country", patch.country?.trim().toUpperCase() || null);
  if (patch.preferredName !== undefined && (patch.preferredName?.trim() || null) !== before.preferredName) set.preferredName = patch.preferredName?.trim() || null;
  if (patch.region !== undefined && (patch.region?.trim() || null) !== before.region) set.region = patch.region?.trim() || null;
  if (patch.contactTypes && patch.contactTypes.join() !== before.contactTypes.join()) set.contactTypes = patch.contactTypes;
  if (patch.relationshipOwnerId !== undefined && patch.relationshipOwnerId !== before.relationshipOwnerId) set.relationshipOwnerId = patch.relationshipOwnerId;
  if (patch.isPriority !== undefined && patch.isPriority !== before.isPriority) set.isPriority = patch.isPriority;
  if (Object.keys(set).length === 0) return;
  await tx.update(persons).set(set).where(eq(persons.id, personId));
  await write(tx, actor, "person.updated", "person", personId, pick(before, Object.keys(set)), { ...set, source_note: source.note ?? null });
}

export class DuplicateLinkedinError extends Error {
  constructor(public readonly personId: string) {
    super("Another person already has this LinkedIn URL.");
  }
}
