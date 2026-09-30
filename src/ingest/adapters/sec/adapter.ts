/**
 * SEC EDGAR Form 8-K Item 5.02 monitoring (BRD 8.2): director and officer departures and
 * appointments at tracked US public companies. A primary source, eligible for auto-confirm (M4).
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { companies, queueItems } from "@/db/schema";
import { updateCompany } from "@/domain/records";
import { normaliseCompanyName } from "@/lib/normalise";
import { readFixture } from "../../fixtures";
import { assertOk, HttpError, mockHttp, ok, type HttpClient } from "../../http";
import type { Feed, HealthResult, RawItemInput, SourceAdapter, WorkspaceCtx } from "../../types";
import { cikCandidates, COMPANY_TICKERS_URL, extractItem502, filingDocumentUrl, item502Filings, submissionsUrl, type Submissions, type TickerEntry } from "./parse";

/** How far back the first run looks, and the overlap kept on later runs for late acceptances. */
const FIRST_RUN_DAYS = 30;
const OVERLAP_DAYS = 3;
const DAY = 86_400_000;

export class SecConfigurationError extends Error {}

export function createSecAdapter(http: HttpClient, userAgent: string | undefined): SourceAdapter {
  const requireAgent = () => {
    if (http.mode !== "mock" && !userAgent?.trim()) {
      throw new SecConfigurationError("Set SEC_USER_AGENT to your organization name and a contact email, as the SEC's fair access rules require.");
    }
  };

  const getJson = async <T>(url: string, what: string): Promise<T> => {
    const response = await http.request({ method: "GET", url, headers: { accept: "application/json" } });
    assertOk(response, what);
    return JSON.parse(response.text) as T;
  };

  return {
    key: "sec_8k",
    async *fetch(ctx: WorkspaceCtx, _feed: Feed, since: Date | null): AsyncIterable<RawItemInput> {
      requireAgent();
      await resolveMissingCiks(ctx, () => getJson<Record<string, TickerEntry>>(COMPANY_TICKERS_URL, "The SEC ticker file"));
      const from = since ? new Date(since.getTime() - OVERLAP_DAYS * DAY) : new Date(ctx.now.getTime() - FIRST_RUN_DAYS * DAY);
      const tracked = await ctx.tx.select({ id: companies.id, name: companies.name, cik: companies.secCik }).from(companies).where(isNotNull(companies.secCik));

      for (const company of tracked) {
        const response = await http.request({ method: "GET", url: submissionsUrl(company.cik!), headers: { accept: "application/json" } });
        // A CIK with no submissions file (a wrong or withdrawn CIK) is skipped; it must not stop
        // every other company. Other errors fail the run so it is retried.
        if (response.status === 404) continue;
        assertOk(response, `EDGAR submissions for ${company.name}`);
        const submissions = JSON.parse(response.text) as Submissions;
        for (const filing of item502Filings(submissions, from)) {
          const url = filingDocumentUrl(company.cik!, filing);
          const doc = await http.request({ method: "GET", url, headers: { accept: "text/html" } });
          assertOk(doc, `The ${filing.form} filing ${filing.accessionNumber}`);
          yield {
            externalId: `sec:${filing.accessionNumber}`,
            url,
            title: `${filing.form} Item 5.02: ${submissions.name || company.name}`,
            bodyText: extractItem502(doc.text),
            publishedAt: filing.acceptedAt,
            payload: { cik: company.cik, company_id: company.id, accession_number: filing.accessionNumber, form: filing.form, items: filing.items, filing_date: filing.filingDate },
          };
        }
      }
    },
    async healthCheck(ctx): Promise<HealthResult> {
      try {
        requireAgent();
        const [first] = await ctx.tx.select({ cik: companies.secCik, name: companies.name }).from(companies).where(isNotNull(companies.secCik)).limit(1);
        if (!first) return { ok: true, message: "No tracked company has an SEC CIK yet, so there is nothing to watch." };
        const s = await getJson<Submissions>(submissionsUrl(first.cik!), "EDGAR");
        return { ok: true, message: `EDGAR reachable. Read ${s.filings.recent.accessionNumber.length} recent filings for ${first.name}.` };
      } catch (error) {
        if (error instanceof SecConfigurationError) return { ok: false, message: error.message };
        if (error instanceof HttpError) return { ok: false, message: error.message, detail: error.detail };
        throw error;
      }
    },
  };
}

/**
 * Public companies added without a CIK get one from the SEC ticker file (BRD 8.2). A single
 * candidate is stored; several raise an ambiguous_cik queue item, once per company.
 */
export async function resolveMissingCiks(ctx: WorkspaceCtx, loadTickers: () => Promise<Record<string, TickerEntry>>): Promise<{ resolved: number; ambiguous: number }> {
  const missing = await ctx.tx.select().from(companies).where(and(eq(companies.ownership, "public"), isNull(companies.secCik)));
  if (missing.length === 0) return { resolved: 0, ambiguous: 0 };
  const tickers = await loadTickers();
  let resolved = 0;
  let ambiguous = 0;
  for (const company of missing) {
    const candidates = cikCandidates(tickers, { tickers: company.aliases, name: company.name }, normaliseCompanyName);
    if (candidates.length === 1) {
      const cik = String(candidates[0]!.cik_str).padStart(10, "0");
      await updateCompany(ctx.tx, { workspaceId: ctx.workspaceId, userId: null, kind: "system" }, company.id, { secCik: cik }, { sourceType: "sec_8k", sourceUrl: COMPANY_TICKERS_URL, confidence: "high", note: "Matched in the SEC ticker file." });
      resolved++;
    } else if (candidates.length > 1) {
      const [open] = await ctx.tx
        .select({ id: queueItems.id })
        .from(queueItems)
        .where(and(eq(queueItems.kind, "ambiguous_cik"), eq(queueItems.status, "pending"), sql`${queueItems.payload}->>'company_id' = ${company.id}`))
        .limit(1);
      if (!open) {
        await ctx.tx.insert(queueItems).values({
          workspaceId: ctx.workspaceId,
          kind: "ambiguous_cik",
          payload: { company_id: company.id, candidates: candidates.map((c) => ({ cik: String(c.cik_str).padStart(10, "0"), ticker: c.ticker, title: c.title })) },
        });
        ambiguous++;
      }
    }
  }
  return { resolved, ambiguous };
}

/** Mock transport: submissions, filing documents and the ticker file from fixtures/sec/. */
export function secFixtureHttp(now: () => Date): HttpClient {
  return mockHttp(async (req) => {
    const url = new URL(req.url);
    let file: string | undefined;
    if (url.host === "data.sec.gov" && url.pathname.startsWith("/submissions/")) file = `sec/submissions/${url.pathname.split("/").pop()}`;
    else if (url.host === "www.sec.gov" && url.pathname === "/files/company_tickers.json") file = "sec/company_tickers.json";
    else if (url.host === "www.sec.gov" && url.pathname.startsWith("/Archives/edgar/data/")) file = `sec/archives/${url.pathname.slice("/Archives/edgar/data/".length)}`;
    if (!file) return undefined;
    const text = await readFixture(file, now());
    return text === undefined ? undefined : ok(text, file.endsWith(".json") ? "application/json" : "text/html");
  });
}
