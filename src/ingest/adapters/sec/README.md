# SEC EDGAR: Form 8-K Item 5.02

Adapter for BRD 8.2 (`sec_8k`). Watches every company in the workspace that has an SEC CIK.

**How it works**

1. Public companies without a CIK are matched in the SEC ticker file (`https://www.sec.gov/files/company_tickers.json`), by ticker and then by exact normalised name. One match is stored on the company (source `sec_8k`, high confidence); several raise an `ambiguous_cik` queue item.
2. For each company, `GET https://data.sec.gov/submissions/CIK##########.json` (10-digit, zero-padded CIK). The `filings.recent` arrays are read column by column: `form`, `items` (comma separated, for example `"5.02,9.01"`), `accessionNumber`, `primaryDocument`, `filingDate`, `acceptanceDateTime`.
3. Filings with form `8-K` or `8-K/A` whose items include `5.02`, accepted since the last successful run (less a 3-day overlap; 30 days on the first run), are fetched from `https://www.sec.gov/Archives/edgar/data/<CIK without leading zeros>/<accession number without dashes>/<primary document>`.
4. The Item 5.02 section (from its heading to the next item heading or the signatures) becomes `body_text`. External ID: `sec:<accession number>`.

**Fair access.** Every request carries `SEC_USER_AGENT`, which must name the organization and a contact email (for example `Markivis intelligence@markivis.com`). Live and record modes refuse to run without it. Requests are spaced at least 150 ms apart per process (under 7 per second), below the SEC's limit of 10 per second.

**Schedule.** Every 30 minutes from 06:00 to 22:00 US Eastern on business days, every 2 hours otherwise (`src/jobs/definitions.ts`).

**Documentation (read 2026-09-30):**
- EDGAR APIs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- Fair access and the 10 requests per second limit: https://www.sec.gov/about/developer-resources
- User-Agent declaration and the ticker file: https://www.sec.gov/os/webmaster-faq#developers
- Archive paths: https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
