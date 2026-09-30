/**
 * Apollo (BRD 8.1): business emails with verification status, firmographics, and job changes by
 * weekly re-enrichment of every tracked person, diffing employer and title. Record updates go
 * through provenance (source apollo); job changes become raw items for the pipeline.
 *
 * Intent topics: Apollo's public API reference documents no intent endpoint (checked 2026-09-30),
 * so none is called; company_intent_spike waits on confirmation of the client's plan (BRD 25 #8).
 */
import { createHash } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { companies, persons, roles } from "@/db/schema";
import { observeField } from "@/domain/provenance";
import { readWorkspaceSecret } from "@/domain/secrets";
import { updateCompany } from "@/domain/records";
import { readJsonFixture } from "../../fixtures";
import { assertOk, HttpError, mockHttp, ok, type HttpClient } from "../../http";
import type { Feed, HealthResult, RawItemInput, SourceAdapter, WorkspaceCtx } from "../../types";
import { assertUnderCap, CapReachedError, recordUsage } from "../../usage";
import { alignMatches, detectJobChange, mapEmailStatus, type ApolloOrganization, type ApolloPerson } from "./map";

export const APOLLO_BASE = "https://api.apollo.io/api/v1";
export const BULK_SIZE = 10;

interface Detail {
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string | null;
  domain?: string | null;
  organization_name?: string;
  linkedin_url?: string | null;
}

export class ApolloConfigurationError extends Error {}

export interface ApolloRunOptions {
  /** On-demand enrichment of newly added records is essential; the weekly sweep is not. */
  essential?: boolean;
  personIds?: string[];
  companyIds?: string[];
}

export function createApolloAdapter(http: HttpClient, runOptions: ApolloRunOptions = {}): SourceAdapter {
  async function apiKey(ctx: WorkspaceCtx): Promise<string> {
    if (http.mode === "mock") return "mock-key";
    const key = await readWorkspaceSecret(ctx.tx, ctx.workspaceId, "apollo_api_key");
    if (!key) throw new ApolloConfigurationError("Add the workspace's Apollo API key in Settings, Sources.");
    return key;
  }
  const cap = (ctx: WorkspaceCtx) => ((ctx.settings.apollo as { monthly_credit_cap?: number | null } | undefined)?.monthly_credit_cap ?? null);

  async function call<T>(ctx: WorkspaceCtx, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await http.request({ method, url: `${APOLLO_BASE}${path}`, headers: { "x-api-key": await apiKey(ctx), "cache-control": "no-cache", accept: "application/json" }, body });
    assertOk(response, "Apollo");
    return JSON.parse(response.text) as T;
  }

  return {
    key: "apollo",
    async *fetch(ctx: WorkspaceCtx, _feed: Feed): AsyncIterable<RawItemInput> {
      const essential = runOptions.essential ?? false;
      const limit = cap(ctx);

      // People: the primary current role of every tracked person, or the ones asked for.
      const people = await ctx.tx
        .select({ personId: persons.id, fullName: persons.fullName, linkedinUrl: persons.linkedinUrl, roleId: roles.id, title: roles.title, email: roles.businessEmail, companyName: companies.name, companyDomain: companies.domain, companyId: companies.id })
        .from(persons)
        .innerJoin(roles, and(eq(roles.personId, persons.id), eq(roles.isPrimary, true)))
        .innerJoin(companies, eq(companies.id, roles.companyId))
        .where(and(eq(persons.isTracked, true), isNull(persons.mergedIntoId)));
      const wanted = runOptions.personIds ? people.filter((p) => runOptions.personIds!.includes(p.personId)) : runOptions.companyIds ? [] : people;

      for (let i = 0; i < wanted.length; i += BULK_SIZE) {
        const batch = wanted.slice(i, i + BULK_SIZE);
        await assertUnderCap(ctx, "apollo", limit, batch.length, essential);
        const details: Detail[] = batch.map((p) => ({ name: p.fullName, email: p.email, domain: p.companyDomain, organization_name: p.companyName, linkedin_url: p.linkedinUrl }));
        // Personal emails are never requested: the platform stores only business contact details.
        const result = await call<{ matches?: (ApolloPerson | null)[]; credits_consumed?: number }>(ctx, "POST", "/people/bulk_match?reveal_personal_emails=false&reveal_phone_number=false", { details });
        await recordUsage(ctx, "apollo", result.credits_consumed ?? (result.matches ?? []).filter(Boolean).length, limit);
        const matches = alignMatches(details, result.matches ?? []);

        for (const [index, person] of batch.entries()) {
          const match = matches[index];
          if (!match) continue;
          const source = { sourceType: "apollo" as const, sourceUrl: null };

          // Email through provenance, with Apollo's verification status.
          if (match.email) {
            const status = mapEmailStatus(match.email_status, true);
            const observed = await observeField(ctx.tx, { workspaceId: ctx.workspaceId, entityType: "role", entityId: person.roleId, field: "business_email", value: match.email.toLowerCase(), ...source, confidence: status === "verified" ? "high" : "low" });
            if (observed.current === match.email.toLowerCase()) await ctx.tx.update(roles).set({ businessEmail: observed.current, emailStatus: status }).where(eq(roles.id, person.roleId));
          }

          const change = detectJobChange({ companyName: person.companyName, companyDomain: person.companyDomain, title: person.title }, match);
          if (change) {
            const fingerprint = createHash("sha256").update(`${change.current.organizationName}|${change.current.title}`).digest("hex").slice(0, 16);
            yield {
              externalId: `apollo:change:${person.personId}:${fingerprint}`,
              url: null,
              title: `Apollo: ${person.fullName} is now ${change.current.title} at ${change.current.organizationName}`,
              bodyText: `Apollo reports ${person.fullName} as ${change.current.title} at ${change.current.organizationName}. Our record shows ${person.title} at ${person.companyName}.`,
              publishedAt: ctx.now,
              payload: { kind: `job_change_${change.kind}`, person_id: person.personId, role_id: person.roleId, previous: change.previous, current: change.current },
              identifies: { emails: match.email ? [match.email] : [], linkedinUrls: match.linkedin_url ? [match.linkedin_url] : [] },
            };
          }
        }
      }

      // Companies: firmographics for every company with a domain, or the ones asked for.
      const orgs = await ctx.tx.select({ id: companies.id, name: companies.name, domain: companies.domain }).from(companies).where(isNotNull(companies.domain));
      const orgsWanted = runOptions.companyIds ? orgs.filter((c) => runOptions.companyIds!.includes(c.id)) : runOptions.personIds ? [] : orgs;
      for (const company of orgsWanted) {
        await assertUnderCap(ctx, "apollo", limit, 1, essential);
        const { organization } = await call<{ organization?: ApolloOrganization }>(ctx, "GET", `/organizations/enrich?domain=${encodeURIComponent(company.domain!)}`);
        await recordUsage(ctx, "apollo", organization ? 1 : 0, limit);
        if (!organization) continue;
        await updateCompany(
          ctx.tx,
          { workspaceId: ctx.workspaceId, userId: null, kind: "system" },
          company.id,
          { employeeCount: organization.estimated_num_employees ?? undefined, industry: organization.industry ?? undefined },
          { sourceType: "apollo", confidence: "medium", note: "Apollo organization enrichment." },
        );
        if (organization.id) await ctx.tx.update(companies).set({ apolloOrgId: organization.id }).where(eq(companies.id, company.id));
      }
    },
    async healthCheck(ctx): Promise<HealthResult> {
      try {
        // Usage stats cost no credits. It needs a master key or that scope; a 403 still proves the key exists.
        const response = await http.request({ method: "POST", url: `${APOLLO_BASE}/usage_stats/api_usage_stats`, headers: { "x-api-key": await apiKey(ctx), accept: "application/json" } });
        if (response.status === 403) return { ok: true, message: "Apollo accepted the key. It cannot read usage limits, which needs a master key; enrichment still works." };
        assertOk(response, "Apollo");
        return { ok: true, message: "Apollo reachable, and the key is valid." };
      } catch (error) {
        if (error instanceof ApolloConfigurationError || error instanceof CapReachedError) return { ok: false, message: error.message };
        if (error instanceof HttpError) return { ok: false, message: error.message, detail: error.detail };
        throw error;
      }
    },
  };
}

/** Mock transport: people matched by email or LinkedIn from fixtures/apollo/people.json, organizations by domain. */
export function apolloFixtureHttp(now: () => Date): HttpClient {
  return mockHttp(async (req) => {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/usage_stats/api_usage_stats")) return ok("{}");
    if (url.pathname.endsWith("/people/bulk_match")) {
      const people = (await readJsonFixture<ApolloPerson[]>("apollo/people.json", now())) ?? [];
      const details = ((req.body as { details?: Detail[] })?.details ?? []);
      const matches = details.map((d) => people.find((p) => (d.email && p.email?.toLowerCase() === d.email.toLowerCase()) || (d.linkedin_url && p.linkedin_url === d.linkedin_url)) ?? null);
      return ok(JSON.stringify({ status: "success", matches, credits_consumed: matches.filter(Boolean).length }));
    }
    if (url.pathname.endsWith("/organizations/enrich")) {
      const orgs = (await readJsonFixture<Record<string, ApolloOrganization>>("apollo/organizations.json", now())) ?? {};
      const organization = orgs[url.searchParams.get("domain") ?? ""];
      return ok(JSON.stringify(organization ? { organization } : {}));
    }
    return undefined;
  });
}
