import { describe, expect, it } from "vitest";
import { alignMatches, detectJobChange, mapEmailStatus } from "@/ingest/adapters/apollo/map";
import { diffLines, isSignificantLine } from "@/ingest/adapters/pages/diff";
import { fixtureNameForUrl, parseFeed, unwrapLink } from "@/ingest/adapters/rss/parse";
import { cikCandidates, extractItem502, filingDocumentUrl, item502Filings, submissionsUrl } from "@/ingest/adapters/sec/parse";
import { parseNewsletterCsv } from "@/ingest/adapters/newsletter/adapter";
import { resolveTokens } from "@/ingest/fixtures";
import { excerpt, htmlToLines } from "@/ingest/html";
import { RateLimiter } from "@/ingest/rate-limit";
import { scrub } from "@/ingest/scrub";
import { decryptSecret, encryptSecret, EncryptionConfigError } from "@/lib/crypto";
import { normaliseCompanyName } from "@/lib/normalise";

describe("RSS and Atom", () => {
  it("parses RSS 2.0 items, stripping HTML", () => {
    const [item] = parseFeed(`<rss version="2.0"><channel><item><title>A &amp; B</title><link>https://x.example.com/1</link><guid>g1</guid><pubDate>Tue, 29 Sep 2026 13:30:00 GMT</pubDate><description>&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/p&gt;</description></item></channel></rss>`);
    expect(item).toEqual({ id: "g1", link: "https://x.example.com/1", title: "A & B", summary: "Hello world", published: new Date("2026-09-29T13:30:00Z") });
  });
  it("parses Atom entries and unwraps Google Alerts links", () => {
    const [entry] = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:1</id><title type="html">&lt;b&gt;Name&lt;/b&gt; joins</title><link href="https://www.google.com/url?rct=j&amp;url=https%3A%2F%2Fnews.example.net%2Fa&amp;ct=ga"/><published>2026-09-29T10:00:00Z</published><content type="html">Body</content></entry></feed>`);
    expect(entry).toMatchObject({ id: "tag:1", link: "https://news.example.net/a", title: "Name joins", summary: "Body" });
  });
  it("rejects documents that are not feeds", () => {
    expect(() => parseFeed("<html><body>Hi</body></html>")).toThrow(/not an RSS or Atom/);
  });
  it("leaves ordinary links alone and names fixtures after URLs", () => {
    expect(unwrapLink("https://news.example.net/a")).toBe("https://news.example.net/a");
    expect(fixtureNameForUrl("https://wire.example.net/rss/appointments")).toBe("wire.example.net_rss_appointments.xml");
  });
});

describe("SEC EDGAR", () => {
  const submissions = {
    cik: "320193",
    name: "Example",
    filings: {
      recent: {
        accessionNumber: ["0000000000-26-000001", "0000000000-26-000002", "0000000000-26-000003", "0000000000-26-000004"],
        filingDate: ["2026-09-28", "2026-09-27", "2026-09-26", "2025-01-01"],
        acceptanceDateTime: ["2026-09-28T16:05:00.000Z", "2026-09-27T16:05:00.000Z", "2026-09-26T16:05:00.000Z", "2025-01-01T16:05:00.000Z"],
        form: ["8-K", "10-Q", "8-K/A", "8-K"],
        items: ["2.02,5.02,9.01", "", "5.02", "5.02"],
        primaryDocument: ["a.htm", "b.htm", "c.htm", "d.htm"],
      },
    },
  };
  it("selects recent 8-K and 8-K/A filings that include Item 5.02", () => {
    expect(item502Filings(submissions, new Date("2026-09-01")).map((f) => f.accessionNumber)).toEqual(["0000000000-26-000001", "0000000000-26-000003"]);
  });
  it("builds the submissions and archive addresses", () => {
    expect(submissionsUrl("320193")).toBe("https://data.sec.gov/submissions/CIK0000320193.json");
    expect(filingDocumentUrl("0000320193", { accessionNumber: "0001193125-15-118890", primaryDocument: "d8k.htm" })).toBe("https://www.sec.gov/Archives/edgar/data/320193/000119312515118890/d8k.htm");
  });
  it("extracts only the Item 5.02 section", () => {
    const html = "<p>Item 2.02 Results</p><p>Earnings.</p><p><b>Item 5.02 Departure of Directors</b></p><p>Jane Example resigned.</p><p>Item 9.01 Exhibits</p><p>SIGNATURES</p>";
    expect(extractItem502(html)).toBe("Item 5.02 Departure of Directors\nJane Example resigned.");
  });
  it("finds CIK candidates by ticker, then by exact name", () => {
    const tickers = { "0": { cik_str: 1, ticker: "AAA", title: "ALPHA INC" }, "1": { cik_str: 2, ticker: "BBB", title: "BETA CORP" }, "2": { cik_str: 3, ticker: "BBBP", title: "BETA CORP" } };
    expect(cikCandidates(tickers, { tickers: ["aaa"], name: "x" }, normaliseCompanyName).map((c) => c.cik_str)).toEqual([1]);
    expect(cikCandidates(tickers, { tickers: [], name: "Beta Corp." }, normaliseCompanyName).map((c) => c.cik_str)).toEqual([2, 3]);
  });
});

describe("leadership page diffs", () => {
  it("keeps names and titles, ignores navigation and footers", () => {
    expect(isSignificantLine("Jordan Example")).toBe(true);
    expect(isSignificantLine("Chief Financial Officer")).toBe(true);
    expect(isSignificantLine("Copyright Example Inc. All rights reserved.")).toBe(false);
    expect(diffLines(["Home", "Jane Example", "Chief Financial Officer"], ["Home", "Chief Financial Officer", "Omar Example", "Chief People Officer"])).toEqual({
      added: ["Omar Example", "Chief People Officer"],
      removed: ["Jane Example"],
    });
  });
  it("reads visible text only", () => {
    expect(htmlToLines('<div>Visible</div><script>var x</script><div hidden>Hidden</div><p style="display: none">Gone</p><p>Also <b>visible</b></p>')).toEqual(["Visible", "Also visible"]);
  });
});

describe("Apollo mapping", () => {
  it("treats anything but verified as guessed, and bounced as invalid", () => {
    expect(mapEmailStatus("verified", true)).toBe("verified");
    expect(mapEmailStatus("extrapolated", true)).toBe("guessed");
    expect(mapEmailStatus("bounced", true)).toBe("invalid");
    expect(mapEmailStatus(null, false)).toBe("unknown");
  });
  it("detects a new employer by domain or name, and a new normalised title", () => {
    const role = { companyName: "Example Holdings, Inc.", companyDomain: "example.com", title: "Chief Financial Officer" };
    expect(detectJobChange(role, { title: "CFO", organization: { name: "Example Holdings", primary_domain: "example.com" } })).toBeNull();
    expect(detectJobChange(role, { title: "CFO", organization: { name: "Other Co", primary_domain: "other.example.org" } })?.kind).toBe("employer");
    expect(detectJobChange(role, { title: "Chief Executive Officer", organization: { name: "Example Holdings" } })?.kind).toBe("title");
  });
  it("aligns bulk matches by email when counts differ", () => {
    const matches = alignMatches([{ email: "a@x.example.com" }, { email: "b@x.example.com" }], [{ email: "B@x.example.com", name: "B" }]);
    expect(matches.map((m) => m?.name ?? null)).toEqual([null, "B"]);
  });
});

describe("newsletter CSV", () => {
  it("parses valid rows and reports invalid ones by row", () => {
    const { rows, rejected } = parseNewsletterCsv("email,event,occurred_at,topics\na@x.example.com,click,2026-09-01T10:00:00Z,CFO agenda; Board composition\nbad,click,2026-09-01,\nb@x.example.com,forward,2026-09-01,\n");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.topics).toEqual(["CFO agenda", "Board composition"]);
    expect(rejected.map((r) => r.rowNumber)).toEqual([3, 4]);
  });
});

describe("support", () => {
  it("resolves date tokens against the clock", () => {
    const now = new Date("2026-09-30T08:00:00Z");
    expect(resolveTokens("{{date:-3}} {{date:+30}}", now)).toBe("2026-09-27 2026-10-30");
    expect(resolveTokens("{{datetime:0}}", now)).toBe("2026-09-30T13:30:00.000Z");
    expect(resolveTokens("{{rfc822:-1}}", now)).toBe("Tue, 29 Sep 2026 13:30:00 GMT");
  });
  it("spaces requests per key", async () => {
    let clock = 0;
    const waits: number[] = [];
    const limiter = new RateLimiter(100, async (ms) => { waits.push(ms); }, () => clock);
    await limiter.wait("a");
    await limiter.wait("a");
    await limiter.wait("b");
    clock = 150;
    await limiter.wait("a");
    expect(waits).toEqual([100, 50]);
  });
  it("replaces emails, LinkedIn slugs and phone numbers when recording", () => {
    const out = scrub("Contact jane.doe@realco.com or +1 (617) 555-0142, linkedin.com/in/jane-doe");
    expect(out).not.toMatch(/jane\.doe@realco|617|jane-doe/);
    expect(scrub("jane.doe@realco.com")).toBe(scrub("JANE.DOE@realco.com"));
  });
  it("encrypts with a per-value data key and refuses a missing master key", () => {
    const env = { TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
    const a = encryptSecret("apollo-key-123", env);
    const b = encryptSecret("apollo-key-123", env);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(decryptSecret(a.ciphertext, env)).toBe("apollo-key-123");
    expect(() => decryptSecret(a.ciphertext, { TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64") })).toThrow();
    expect(() => encryptSecret("x", {})).toThrow(EncryptionConfigError);
  });
  it("cuts excerpts at a word boundary", () => {
    expect(excerpt("one two three four", 9)).toBe("one two");
  });
});
