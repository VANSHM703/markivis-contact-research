/** SEC EDGAR parsing (BRD 8.2). Pure. Field names verified against data.sec.gov on 2026-09-30. */
import { htmlToLines } from "../../html";

export interface Submissions {
  cik: string;
  name: string;
  tickers?: string[];
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      acceptanceDateTime: string[];
      form: string[];
      items: string[];
      primaryDocument: string[];
    };
  };
}

export interface Filing {
  accessionNumber: string;
  filingDate: string;
  acceptedAt: Date;
  form: string;
  items: string[];
  primaryDocument: string;
}

export const ITEM_502 = "5.02";

/** 8-K and 8-K/A filings whose items include 5.02, accepted at or after `since`. */
export function item502Filings(submissions: Submissions, since: Date): Filing[] {
  const r = submissions.filings.recent;
  const out: Filing[] = [];
  for (let i = 0; i < r.accessionNumber.length; i++) {
    const form = r.form[i] ?? "";
    if (form !== "8-K" && form !== "8-K/A") continue;
    const items = (r.items[i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!items.includes(ITEM_502)) continue;
    const accepted = new Date(r.acceptanceDateTime[i] ?? r.filingDate[i] ?? 0);
    if (Number.isNaN(accepted.getTime()) || accepted < since) continue;
    out.push({ accessionNumber: r.accessionNumber[i]!, filingDate: r.filingDate[i]!, acceptedAt: accepted, form, items, primaryDocument: r.primaryDocument[i]! });
  }
  return out;
}

/** https://www.sec.gov/Archives/edgar/data/<CIK without leading zeros>/<accession without dashes>/<primary document> */
export function filingDocumentUrl(cik: string, filing: Pick<Filing, "accessionNumber" | "primaryDocument">): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accessionNumber.replace(/-/g, "")}/${filing.primaryDocument}`;
}

export function submissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`;
}

export const COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

const ITEM_HEADING = /^item\s*(\d+\.\d{2})\b/i;

/**
 * The text of the Item 5.02 section: from its heading to the next item heading or the
 * signatures. Falls back to the whole document when no heading is found.
 */
export function extractItem502(html: string): string {
  const lines = htmlToLines(html);
  const start = lines.findIndex((l) => ITEM_HEADING.exec(l)?.[1] === ITEM_502);
  if (start === -1) return lines.join("\n");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => (ITEM_HEADING.test(l) && ITEM_HEADING.exec(l)?.[1] !== ITEM_502) || /^signatures?\b/i.test(l));
  return [lines[start]!, ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

export interface TickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

/** Candidates in the SEC ticker file for a company, by ticker first, then by exact name. */
export function cikCandidates(tickers: Record<string, TickerEntry>, company: { tickers: string[]; name: string }, normalise: (name: string) => string): TickerEntry[] {
  const entries = Object.values(tickers);
  const wanted = new Set(company.tickers.map((t) => t.toUpperCase()));
  const byTicker = entries.filter((e) => wanted.has(e.ticker.toUpperCase()));
  if (byTicker.length > 0) return dedupeCik(byTicker);
  const name = normalise(company.name);
  return dedupeCik(entries.filter((e) => normalise(e.title) === name));
}

function dedupeCik(entries: TickerEntry[]): TickerEntry[] {
  return [...new Map(entries.map((e) => [e.cik_str, e])).values()];
}
