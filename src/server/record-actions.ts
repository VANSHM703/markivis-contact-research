"use server";

/** Server actions for manual entry, editing, role changes and merges (BRD 16.4, 7.2, 7.3). */
import { redirect } from "next/navigation";
import type { FormState } from "@/components/forms/FormState";
import { withWorkspace } from "@/db/client";
import { resolveCompany } from "@/domain/matching";
import { enqueueQuietly } from "@/jobs/enqueue";
import { MergeError, mergePersons, unmergePerson } from "@/domain/merge";
import { addRole, createCompany, DuplicateLinkedinError, endRole, findOrCreateCompany, updateCompany, updatePerson, upsertPerson, type Actor, type SourceNote } from "@/domain/records";
import { SuppressedError } from "@/domain/suppression";
import { execSearchOn } from "@/lib/packs";
import { getRequestContext, type RequestContext } from "@/lib/context";
import { can, type Capability } from "@/lib/permissions";
import { companySchema, formObject, invalidAll, parseForm, personSchema, roleSchema, sourceSchema } from "./forms";

async function requireContext(capability: Capability): Promise<RequestContext> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!can(ctx.role, capability)) redirect("/?notice=not_allowed");
  return ctx;
}

const actorOf = (ctx: RequestContext): Actor => ({ workspaceId: ctx.workspace.id, userId: ctx.user.id });

function sourceOf(parsed: { source_type: SourceNote["sourceType"]; source_note: string; source_url: string | null }): SourceNote {
  return { sourceType: parsed.source_type, note: parsed.source_note, sourceUrl: parsed.source_url };
}

const PERSON_FORM = { arrays: ["contact_types"], booleans: ["is_priority"] };

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------

export async function createPersonAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireContext("records.edit");
  const raw = formObject(formData, PERSON_FORM);
  const person = parseForm(personSchema, raw);
  const role = parseForm(roleSchema, raw);
  const source = parseForm(sourceSchema, raw);
  const noCompany = !String(raw.company_id ?? "").trim() && !String(raw.company_new ?? "").trim();
  const problems = invalidAll([person, role, source], raw, noCompany ? { company: "Choose a company, or add a new one." } : {});
  if (problems || !person.success || !role.success || !source.success) return problems!;

  const note = sourceOf(source.data);
  let result;
  try {
    result = await withWorkspace(ctx.workspace.id, async (tx) => {
      const actor = actorOf(ctx);
      const companyId = role.data.company_id || (await findOrCreateCompany(tx, actor, { name: role.data.company_new! }, note)).companyId;
      return upsertPerson(
        tx,
        actor,
        {
          fullName: person.data.full_name,
          preferredName: person.data.preferred_name,
          linkedinUrl: person.data.linkedin_url,
          city: person.data.city,
          region: person.data.region,
          country: person.data.country,
          // Contact types belong to the executive search pack (BRD 13).
          contactTypes: execSearchOn(ctx.workspace) ? person.data.contact_types : [],
          relationshipOwnerId: ctx.user.id,
          isPriority: person.data.is_priority,
        },
        [{ companyId, title: role.data.title, seatType: role.data.seat_type, businessEmail: role.data.business_email, effectiveOn: role.data.effective_on, endedOn: role.data.ended_on }],
        note,
      );
    });
  } catch (error) {
    if (error instanceof SuppressedError) return { message: "This person is on the suppression list, so they cannot be added.", values: stringValues(raw) };
    throw error;
  }
  if (result.outcome === "matched") {
    return {
      message: "This person is already in the workspace, so nothing was added.",
      link: { href: `/people/${result.personId}`, label: "Open their record" },
      values: stringValues(raw),
    };
  }
  // On-demand Apollo enrichment of the new person (BRD 8.1); essential under the credit guard.
  await enqueueQuietly("ingest.apollo", { workspaceId: ctx.workspace.id, personIds: [result.personId] });
  redirect(`/people/${result.personId}?notice=${result.possibleDuplicateOf ? "person_created_possible_duplicate" : "person_created"}`);
}

export async function updatePersonAction(personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireContext("records.edit");
  const raw = formObject(formData, PERSON_FORM);
  const person = parseForm(personSchema, raw);
  const source = parseForm(sourceSchema, raw);
  const problems = invalidAll([person, source], raw);
  if (problems || !person.success || !source.success) return problems!;
  try {
    await withWorkspace(ctx.workspace.id, (tx) =>
      updatePerson(
        tx,
        actorOf(ctx),
        personId,
        {
          fullName: person.data.full_name,
          preferredName: person.data.preferred_name,
          linkedinUrl: person.data.linkedin_url,
          city: person.data.city,
          region: person.data.region,
          country: person.data.country,
          // Without the pack the field is not shown, so the stored types are left as they are.
          contactTypes: execSearchOn(ctx.workspace) ? person.data.contact_types : undefined,
          isPriority: person.data.is_priority,
        },
        sourceOf(source.data),
      ),
    );
  } catch (error) {
    if (error instanceof DuplicateLinkedinError) {
      return { message: "Check this field: LinkedIn profile.", fieldErrors: { linkedin_url: "Another person already has this LinkedIn URL." }, link: { href: `/people/${error.personId}`, label: "Open that record" }, values: stringValues(raw) };
    }
    if (error instanceof SuppressedError) return { message: error.message, values: stringValues(raw) };
    throw error;
  }
  redirect(`/people/${personId}?notice=person_updated`);
}

export async function addRoleAction(personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireContext("records.edit");
  const raw = formObject(formData);
  const role = parseForm(roleSchema, raw);
  const source = parseForm(sourceSchema, raw);
  const noCompany = !String(raw.company_id ?? "").trim() && !String(raw.company_new ?? "").trim();
  const problems = invalidAll([role, source], raw, noCompany ? { company: "Choose a company, or add a new one." } : {});
  if (problems || !role.success || !source.success) return problems!;
  const note = sourceOf(source.data);
  const created = await withWorkspace(ctx.workspace.id, async (tx) => {
    const actor = actorOf(ctx);
    const companyId = role.data.company_id || (await findOrCreateCompany(tx, actor, { name: role.data.company_new! }, note)).companyId;
    return addRole(tx, actor, personId, { companyId, title: role.data.title, seatType: role.data.seat_type, businessEmail: role.data.business_email, effectiveOn: role.data.effective_on, endedOn: role.data.ended_on }, note);
  });
  redirect(`/people/${personId}?notice=${created.created ? "role_added" : "role_exists"}`);
}

export async function endRoleAction(personId: string, roleId: string, formData: FormData): Promise<void> {
  const ctx = await requireContext("records.edit");
  const endedOn = String(formData.get("ended_on") ?? "");
  const note = String(formData.get("source_note") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endedOn) || !note) redirect(`/people/${personId}?notice=end_role_invalid`);
  await withWorkspace(ctx.workspace.id, (tx) => endRole(tx, actorOf(ctx), roleId, endedOn, { sourceType: "manual", note }));
  redirect(`/people/${personId}?notice=role_ended`);
}

export async function mergeAction(survivorId: string, mergedId: string): Promise<void> {
  const ctx = await requireContext("persons.merge");
  try {
    await withWorkspace(ctx.workspace.id, (tx) => mergePersons(tx, actorOf(ctx), survivorId, mergedId));
  } catch (error) {
    if (error instanceof MergeError) redirect(`/people/${survivorId}?notice=merge_failed`);
    throw error;
  }
  redirect(`/people/${survivorId}?notice=merged`);
}

export async function unmergeAction(mergedId: string): Promise<void> {
  const ctx = await requireContext("persons.merge");
  try {
    await withWorkspace(ctx.workspace.id, (tx) => unmergePerson(tx, actorOf(ctx), mergedId));
  } catch (error) {
    if (error instanceof MergeError) redirect(`/people/${mergedId}?notice=unmerge_expired`);
    throw error;
  }
  redirect(`/people/${mergedId}?notice=unmerged`);
}

// ---------------------------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------------------------

const COMPANY_FORM = { booleans: ["is_sponsor"] };

export async function createCompanyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireContext("records.edit");
  const raw = formObject(formData, COMPANY_FORM);
  const company = parseForm(companySchema, raw);
  const source = parseForm(sourceSchema, raw);
  const problems = invalidAll([company, source], raw);
  if (problems || !company.success || !source.success) return problems!;
  const result = await withWorkspace(ctx.workspace.id, async (tx) => {
    const existing = await resolveCompany(tx, { name: company.data.name, domain: company.data.domain, secCik: company.data.sec_cik, ticker: company.data.ticker });
    if (existing) return { existing };
    const id = await createCompany(tx, actorOf(ctx), toCompanyInput(company.data), sourceOf(source.data));
    return { id };
  });
  if ("existing" in result) {
    return { message: "This company is already in the workspace, so nothing was added.", link: { href: `/companies/${result.existing}`, label: "Open its record" }, values: stringValues(raw) };
  }
  await enqueueQuietly("ingest.apollo", { workspaceId: ctx.workspace.id, companyIds: [result.id] });
  redirect(`/companies/${result.id}?notice=company_created`);
}

export async function updateCompanyAction(companyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireContext("records.edit");
  const raw = formObject(formData, COMPANY_FORM);
  const company = parseForm(companySchema, raw);
  const source = parseForm(sourceSchema, raw);
  const problems = invalidAll([company, source], raw);
  if (problems || !company.success || !source.success) return problems!;
  await withWorkspace(ctx.workspace.id, (tx) => updateCompany(tx, actorOf(ctx), companyId, toCompanyInput(company.data), sourceOf(source.data)));
  redirect(`/companies/${companyId}?notice=company_updated`);
}

function toCompanyInput(c: ReturnType<typeof companySchema.parse>) {
  return {
    name: c.name,
    domain: c.domain,
    ticker: c.ticker,
    secCik: c.sec_cik,
    ownership: c.ownership,
    targetTier: c.target_tier,
    industry: c.industry,
    hqCountry: c.hq_country,
    employeeCount: c.employee_count,
    clientStatus: c.client_status,
    isSponsor: c.is_sponsor,
    leadershipPageUrls: c.leadership_page_urls,
  };
}

function stringValues(raw: Record<string, unknown>): Record<string, string | string[]> {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : String(v ?? "")]));
}
