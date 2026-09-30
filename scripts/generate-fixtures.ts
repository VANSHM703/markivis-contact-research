/**
 * Generates /fixtures from the deterministic seed (BRD 21), so every fixture names the seeded,
 * fictional people and companies. Dates are tokens ({{date:-3}}, {{datetime:-3}}, {{rfc822:-3}})
 * resolved at run time against the clock, so the demo stays current.
 *
 *   npx tsx scripts/generate-fixtures.ts
 *
 * Output is committed. Re-run after changing the seed generator.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateSeed, type WorkspaceBundle } from "@/db/seed/generate";
import { createHash } from "node:crypto";
import { fixtureFileForExternalId } from "@/ai/mock";
import { hashText } from "@/ingest/adapters/pages/diff";
import { fixtureNameForUrl } from "@/ingest/adapters/rss/parse";
import { htmlToLines } from "@/ingest/html";

const ROOT = path.resolve("fixtures");
const bundle = generateSeed(new Date("2026-09-30T12:00:00Z"));
const demo = bundle.workspaces[0]!;
const harbor = bundle.workspaces[1]!;

// ---------------------------------------------------------------------------------------------
// Lookups over the seed
// ---------------------------------------------------------------------------------------------

type Company = WorkspaceBundle["companies"][number];
type Person = WorkspaceBundle["persons"][number];

const all = [demo, harbor];
const companyById = new Map(all.flatMap((w) => w.companies.map((c) => [c.id, c] as const)));
const personById = new Map(all.flatMap((w) => w.persons.map((p) => [p.id, p] as const)));

function currentRoles(w: WorkspaceBundle, companyId: string) {
  return w.roles.filter((r) => r.companyId === companyId && r.status === "current");
}
function holder(w: WorkspaceBundle, companyId: string, norm: string): { person: Person; role: WorkspaceBundle["roles"][number] } | null {
  const role = currentRoles(w, companyId).find((r) => r.titleNormalised === norm);
  return role ? { person: personById.get(role.personId)!, role } : null;
}
function must<T>(value: T | null | undefined, what: string): T {
  if (!value) throw new Error(`Seed has no ${what}; adjust the fixture generator.`);
  return value;
}
const companiesOf = (w: WorkspaceBundle, pred: (c: Company) => boolean | undefined) => w.companies.filter((c) => pred(c) === true);
const publics = companiesOf(demo, (c) => c.ownership === "public");
const peBacked = companiesOf(demo, (c) => c.ownership === "pe_backed");
const clients = companiesOf(demo, (c) => c.clientStatus === "client");
const sponsors = companiesOf(demo, (c) => c.isSponsor);
const privates = companiesOf(demo, (c) => c.ownership === "private" && !c.isSponsor && c.clientStatus !== "client");
const aliasesOf = (c: Company) => c.aliases ?? [];
const pronoun = (i: number) => (i % 2 === 0 ? { s: "she", o: "her", p: "her" } : { s: "he", o: "him", p: "his" });

/** Fictional names used for people who are not in the seed. */
const OUTSIDERS = ["Harriet Quillfeather", "Barnaby Ostrowe", "Clementine Vashti", "Evander Holloway-Price", "Perpetua Grimsby", "Lysander Coyle"];

// A board member with two current seats, one of them at a public company (acceptance scenario 5).
const multiBoard = must(
  demo.persons.find((p) => {
    const seats = demo.roles.filter((r) => r.personId === p.id && r.seatType === "board" && r.status === "current");
    return seats.length === 2 && seats.some((s) => companyById.get(s.companyId)!.ownership === "public");
  }),
  "two-seat director with a public board seat",
);
const multiBoardPublicSeat = demo.roles.find((r) => r.personId === multiBoard.id && r.seatType === "board" && r.status === "current" && companyById.get(r.companyId)!.ownership === "public")!;

// ---------------------------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------------------------

async function put(relative: string, content: string) {
  const full = path.join(ROOT, relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content.endsWith("\n") ? content : `${content}\n`);
}
const json = (v: unknown) => JSON.stringify(v, null, 2);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------------------------------------
// SEC EDGAR
// ---------------------------------------------------------------------------------------------

/** Accession numbers given to each 5.02 filing, in the order of the filings list. */
const SEC_ACCESSIONS: string[] = [];
let SEC_FILINGS: SecFiling[] = [];
/** After-page HTML for each changed leadership page, by company ID. */
const CHANGED_PAGES = new Map<string, { url: string; html: string }>();

interface SecFiling {
  company: Company;
  daysAgo: number;
  form: "8-K" | "8-K/A";
  items: string;
  body: string;
}

async function sec() {
  const [p0, p1, , p3, p4, p5, p6, p7, p8] = publics;
  const cfo0 = must(holder(demo, p0!.id, "CFO"), "CFO at the first public company");
  const mover = must(holder(demo, publics[9]!.id, "CFO") ?? holder(demo, publics[10]!.id, "CFO"), "CFO to move");
  const ceo3 = must(holder(demo, p3!.id, "CEO"), "CEO at public 3");
  const successor3 = must(holder(demo, p3!.id, "CFO"), "CFO at public 3");
  const chro5 = must(holder(demo, p5!.id, "CHRO"), "CHRO at public 5");
  const cto7 = holder(demo, p7!.id, "CTO") ?? must(holder(demo, p7!.id, "CHRO"), "an officer at public 7");
  const chair8 = demo.roles.find((r) => r.companyId === p8!.id && r.titleNormalised === "Chair" && r.status === "current");
  const boardSeatCompany = companyById.get(multiBoardPublicSeat.companyId)!;
  const pr = (i: number) => pronoun(i);

  const filings: SecFiling[] = [
    {
      company: p0!, daysAgo: 1, form: "8-K", items: "5.02,9.01",
      body: `(b) On {{date:-2}}, ${cfo0.person.fullName} notified ${p0!.name} (the "Company") of ${pr(0).p} decision to resign as Chief Financial Officer of the Company, effective {{date:+14}}. ${cfo0.person.fullName}'s decision was not the result of any disagreement with the Company on any matter relating to its operations, policies or practices. The Company has begun a search for a successor.`,
    },
    {
      company: p1!, daysAgo: 3, form: "8-K", items: "5.02,7.01,9.01",
      body: `(c) On {{date:-3}}, the Board of Directors of ${p1!.name} (the "Company") appointed ${mover.person.fullName} as Chief Financial Officer of the Company, effective {{date:+30}}. ${mover.person.fullName}, age 51, currently serves as ${mover.role.title} of ${companyById.get(mover.role.companyId)!.name}. There are no family relationships between ${mover.person.fullName} and any director or executive officer of the Company.`,
    },
    {
      company: boardSeatCompany, daysAgo: 5, form: "8-K", items: "5.02",
      body: `(b) On {{date:-5}}, ${multiBoard.fullName} informed the Board of Directors of ${boardSeatCompany.name} (the "Company") that ${pr(1).s} will not stand for re-election and will retire from the Board at the conclusion of the Company's annual meeting on {{date:+20}}. ${multiBoard.fullName}'s decision did not result from any disagreement with the Company.`,
    },
    {
      company: p3!, daysAgo: 6, form: "8-K", items: "5.02,8.01,9.01",
      body: `(b) On {{date:-6}}, ${ceo3.person.fullName} informed the Board of Directors of ${p3!.name} (the "Company") of ${pr(2).p} intention to retire as Chief Executive Officer, effective {{date:+60}}. (c) The Board has appointed ${successor3.person.fullName}, currently the Company's Chief Financial Officer, to succeed ${ceo3.person.fullName} as Chief Executive Officer, effective {{date:+60}}.`,
    },
    {
      company: p4!, daysAgo: 8, form: "8-K", items: "5.02",
      body: `(d) On {{date:-8}}, the Board of Directors of ${p4!.name} (the "Company") increased the size of the Board from nine to ten members and elected ${OUTSIDERS[0]} as an independent director, effective immediately. ${OUTSIDERS[0]} will serve on the Audit Committee.`,
    },
    {
      company: p5!, daysAgo: 9, form: "8-K", items: "5.02",
      body: `(b) On {{date:-9}}, ${chro5.person.fullName} and ${p5!.name} (the "Company") agreed that ${pr(3).s} will step down as Chief Human Resources Officer, effective {{date:-1}}, to pursue other opportunities.`,
    },
    {
      company: p0!, daysAgo: 0, form: "8-K/A", items: "5.02",
      body: `This Amendment No. 1 amends the Current Report on Form 8-K filed on {{date:-1}} to report that ${cfo0.person.fullName}'s resignation as Chief Financial Officer of ${p0!.name} will now be effective {{date:+10}}. No other changes are made to the original report.`,
    },
    {
      company: p6!, daysAgo: 12, form: "8-K", items: "5.02,9.01",
      body: `(c) On {{date:-12}}, ${p6!.name} (the "Company") announced the appointment of ${OUTSIDERS[1]} as Chief Operating Officer, effective {{date:+7}}. ${OUTSIDERS[1]}, age 47, most recently served as Executive Vice President of Operations at a privately held logistics company.`,
    },
    {
      company: p7!, daysAgo: 14, form: "8-K", items: "5.02",
      body: `(b) On {{date:-14}}, ${cto7.person.fullName} notified ${p7!.name} (the "Company") that ${pr(4).s} will resign as ${cto7.role.title} of the Company, effective {{date:-4}}.`,
    },
    {
      company: p8!, daysAgo: 16, form: "8-K", items: "5.02,5.07",
      body: chair8
        ? `(b) On {{date:-16}}, ${personById.get(chair8.personId)!.fullName} informed the Board of Directors of ${p8!.name} (the "Company") of ${pr(5).p} decision to step down as Chair of the Board, while remaining a director. (d) The Board elected ${OUTSIDERS[2]} as Chair of the Board, effective {{date:-16}}.`
        : `(d) On {{date:-16}}, the Board of Directors of ${p8!.name} (the "Company") elected ${OUTSIDERS[2]} as Chair of the Board, effective {{date:-16}}.`,
    },
  ];

  const allPublic = all.flatMap((w) => companiesOf(w, (c) => c.ownership === "public"));
  let seq = 1;
  for (const company of allPublic) {
    const cik = company.secCik!;
    const own = filings.filter((f) => f.company.id === company.id);
    // Every company also has routine filings the adapter must ignore.
    const routine = [
      { daysAgo: 20, form: "8-K", items: "2.02,9.01", doc: "d8k-earnings.htm" },
      { daysAgo: 35, form: "10-Q", items: "", doc: "d10q.htm" },
      { daysAgo: 400, form: "8-K", items: "5.02", doc: "d8k-old.htm" },
    ];
    const entries = [
      ...own.map((f) => {
        const accession = `99${cik.slice(2, 10)}-26-${String(seq++).padStart(6, "0")}`;
        SEC_ACCESSIONS[filings.indexOf(f)] = accession;
        return { ...f, doc: "d8k.htm", accession };
      }),
      ...routine.map((r) => ({ ...r, company, body: "", accession: `99${cik.slice(2, 10)}-26-${String(seq++).padStart(6, "0")}` })),
    ].sort((a, b) => a.daysAgo - b.daysAgo);

    const col = <K extends string>(fn: (e: (typeof entries)[number]) => K) => entries.map(fn);
    await put(
      `sec/submissions/CIK${cik}.json`,
      json({
        cik: String(Number(cik)),
        entityType: "operating",
        name: company.name,
        tickers: aliasesOf(company),
        exchanges: ["Nasdaq"],
        filings: {
          recent: {
            accessionNumber: col((e) => e.accession),
            filingDate: col((e) => `{{date:-${e.daysAgo}}}`),
            reportDate: col((e) => `{{date:-${e.daysAgo}}}`),
            acceptanceDateTime: col((e) => `{{datetime:-${e.daysAgo}}}`),
            act: col(() => "34"),
            form: col((e) => e.form),
            items: col((e) => e.items),
            primaryDocument: col((e) => e.doc),
            primaryDocDescription: col((e) => e.form),
          },
          files: [],
        },
      }),
    );
    for (const e of entries) {
      const folder = `sec/archives/${Number(cik)}/${e.accession.replace(/-/g, "")}/${e.doc}`;
      const body = e.body || "Routine filing. No change in directors or officers is reported.";
      await put(
        folder,
        `<!DOCTYPE html><html><head><title>${e.form}</title><style>p{margin:0}</style></head><body>
<p>UNITED STATES SECURITIES AND EXCHANGE COMMISSION</p>
<p>FORM ${e.form}</p>
<p>${esc(company.name)}</p>
${e.items.includes("2.02") ? "<p>Item 2.02 Results of Operations and Financial Condition.</p><p>The Company issued a press release announcing its quarterly results.</p>" : ""}
${e.items.includes("5.02") ? `<p><b>Item 5.02 Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers; Compensatory Arrangements of Certain Officers.</b></p><p>${esc(body)}</p>` : `<p>${esc(body)}</p>`}
${e.items.includes("9.01") ? "<p>Item 9.01 Financial Statements and Exhibits.</p><p>(d) Exhibits. 99.1 Press release.</p>" : ""}
<p>SIGNATURES</p><p>Pursuant to the requirements of the Securities Exchange Act of 1934, the registrant has duly caused this report to be signed.</p>
</body></html>`,
      );
    }
  }

  // Ticker file: every seeded public company, plus entries the CIK-resolution tests rely on.
  const tickers: Record<string, { cik_str: number; ticker: string; title: string }> = {};
  allPublic.forEach((c, i) => (tickers[String(i)] = { cik_str: Number(c.secCik), ticker: aliasesOf(c)[0]!, title: c.name.toUpperCase() }));
  let i = allPublic.length;
  tickers[String(i++)] = { cik_str: 9900009001, ticker: "LMRX", title: "LUMERIX THERAPEUTICS INC" };
  tickers[String(i++)] = { cik_str: 9900009002, ticker: "HXC", title: "HARLAN EXAMPLE CORP" };
  tickers[String(i++)] = { cik_str: 9900009003, ticker: "HXCP", title: "HARLAN EXAMPLE CORP" };
  await put("sec/company_tickers.json", json(tickers));
  SEC_FILINGS = filings;
  return filings.length;
}

// ---------------------------------------------------------------------------------------------
// Press release wires (RSS 2.0) and Google Alerts (Atom)
// ---------------------------------------------------------------------------------------------

interface Story {
  guid: string;
  title: string;
  body: string;
  daysAgo: number;
  link: string;
}

async function wires() {
  const pe0 = peBacked[0]!;
  const joiner = must(holder(demo, publics[11]!.id, "COO") ?? holder(demo, publics[11]!.id, "CFO"), "exec to join a PE company");
  const glenmara = must(demo.companies.find((c) => c.hqCountry === "DE"), "German company");
  const germanPerson = must(demo.persons.find((p) => p.country === "DE" && demo.consents.some((c) => c.personId === p.id && c.channel === "email" && c.status === "unknown")), "German person with unknown consent");
  const client = clients[0]!;
  const clientExec = must(holder(demo, client.id, "CFO"), "CFO at the client");
  const award = must(holder(demo, publics[2]!.id, "CFO"), "CFO for the award");
  const speaker = must(holder(demo, peBacked[1]!.id, "CEO"), "CEO to speak");
  const ownDomain = publics[12]!;
  const ownDomainCfo = OUTSIDERS[3];
  const w = "https://wire.example.net/news";

  const stories: Story[] = [
    // Three reports of the same appointment (acceptance scenario 2).
    { guid: "wire-1001", daysAgo: 2, link: `${w}/1001`, title: `${pe0.name} Names ${joiner.person.fullName} Chief Executive Officer`, body: `${pe0.name}, a portfolio company of ${sponsors[0]!.name}, today announced that ${joiner.person.fullName} has joined the company as Chief Executive Officer. ${joiner.person.fullName} was previously ${joiner.role.title} of ${companyById.get(joiner.role.companyId)!.name}.` },
    { guid: "wire-1002", daysAgo: 2, link: `${w}/1002`, title: `${joiner.person.fullName} to Lead ${pe0.name} as CEO`, body: `${sponsors[0]!.name} portfolio company ${pe0.name} has appointed ${joiner.person.fullName} as its new chief executive, effective immediately.` },
    { guid: "wire-1003", daysAgo: 1, link: `${w}/1003`, title: `${pe0.name} Appoints New Chief Executive`, body: `${pe0.name} said ${joiner.person.fullName} has been appointed Chief Executive Officer. The appointment follows a search led by the board.` },
    // EU consent block: a person in Germany.
    { guid: "wire-1004", daysAgo: 3, link: `${w}/1004`, title: `${glenmara.name} Promotes ${germanPerson.fullName}`, body: `${glenmara.name} announced that ${germanPerson.fullName} has been promoted to Chief Operating Officer, with responsibility for plants in Bavaria and Saxony.` },
    // Off-limits: an executive at a current client.
    { guid: "wire-1005", daysAgo: 4, link: `${w}/1005`, title: `${clientExec.person.fullName} to Leave ${client.name}`, body: `${client.name} announced that Chief Financial Officer ${clientExec.person.fullName} will leave the company at the end of the quarter. A search for a successor is under way.` },
    // Company events.
    { guid: "wire-1006", daysAgo: 5, link: `${w}/1006`, title: `${sponsors[1]!.name} Agrees to Acquire ${peBacked[5]!.name}`, body: `${sponsors[1]!.name} has signed a definitive agreement to acquire a majority stake in ${peBacked[5]!.name} from ${sponsors[2]!.name}. Terms were not disclosed.` },
    { guid: "wire-1007", daysAgo: 6, link: `${w}/1007`, title: `${privates[4]!.name} Raises $85 Million Series C`, body: `${privates[4]!.name} today announced an $85 million Series C financing to expand its manufacturing capacity and grow its leadership team.` },
    { guid: "wire-1008", daysAgo: 7, link: `${w}/1008`, title: `${publics[6]!.name} to Acquire ${privates[2]!.name}`, body: `${publics[6]!.name} announced it will acquire ${privates[2]!.name} in an all-cash transaction expected to close next quarter.` },
    { guid: "wire-1009", daysAgo: 8, link: `${w}/1009`, title: `${publics[13]!.name} Announces Restructuring`, body: `${publics[13]!.name} will reduce its workforce by about 8 percent as part of a restructuring plan.` },
    { guid: "wire-1010", daysAgo: 9, link: `${w}/1010`, title: `${peBacked[3]!.name} Expands Into Europe`, body: `${peBacked[3]!.name} opened its first European headquarters in Amsterdam and plans to hire a regional leadership team.` },
    { guid: "wire-1011", daysAgo: 10, link: `${w}/1011`, title: `${award.person.fullName} Named to Finance Leaders List`, body: `${award.person.fullName}, Chief Financial Officer of ${publics[2]!.name}, was named to this year's list of 50 finance leaders to watch.` },
    { guid: "wire-1012", daysAgo: 11, link: `${w}/1012`, title: `${speaker.person.fullName} to Keynote Portfolio Leadership Summit`, body: `${speaker.person.fullName}, Chief Executive Officer of ${peBacked[1]!.name}, will deliver the opening keynote at the Portfolio Leadership Summit in Chicago on {{date:+21}}.` },
    { guid: "wire-1013", daysAgo: 12, link: `${w}/1013`, title: `${publics[8]!.name} and ${publics[9]!.name} Announce Partnership`, body: `${publics[8]!.name} and ${publics[9]!.name} announced a strategic partnership to integrate their platforms.` },
    // Released on the company's own domain: a primary source.
    { guid: "wire-1014", daysAgo: 2, link: `https://${ownDomain.domain}/news/cfo-appointment`, title: `${ownDomain.name} Appoints ${ownDomainCfo} Chief Financial Officer`, body: `${ownDomain.name} today announced the appointment of ${ownDomainCfo} as Chief Financial Officer, effective {{date:+15}}.` },
    // Irrelevant: no tracked company or person.
    { guid: "wire-1015", daysAgo: 3, link: `${w}/1015`, title: "Example Widgets Names New Marketing Chief", body: "Example Widgets, a maker of home goods, named a new chief marketing officer." },
    { guid: "wire-1016", daysAgo: 4, link: `${w}/1016`, title: "Regional Bank Reports Record Deposits", body: "A regional bank reported record deposits for the quarter." },
    { guid: "wire-1017", daysAgo: 5, link: `${w}/1017`, title: "Industry Survey Finds Rising Demand for Interim Executives", body: "A survey of 400 companies found rising demand for interim executives in finance and operations." },
    { guid: "wire-1018", daysAgo: 6, link: `${w}/1018`, title: "Sample Foods Opens New Distribution Center", body: "Sample Foods opened a distribution center in Ohio." },
    { guid: "wire-1019", daysAgo: 7, link: `${w}/1019`, title: "Conference Announces Speaker Lineup", body: "The annual supply chain conference announced its speaker lineup for next spring." },
    { guid: "wire-1020", daysAgo: 8, link: `${w}/1020`, title: "Nonprofit Names Executive Director", body: "A community nonprofit named a new executive director after a national search." },
  ];

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>Appointments wire (demo)</title>
<link>https://wire.example.net/</link>
<description>Fictional press releases for BEAM Decision-Maker Intelligence mock mode.</description>
${stories
  .map(
    (s) => `<item>
<title>${esc(s.title)}</title>
<link>${esc(s.link)}</link>
<guid isPermaLink="false">${s.guid}</guid>
<pubDate>{{rfc822:-${s.daysAgo}}}</pubDate>
<description>${esc(`<p>${s.body}</p>`)}</description>
</item>`,
  )
  .join("\n")}
</channel>
</rss>`;
  await put(`wires/${fixtureNameForUrl("https://wire.example.net/rss/appointments")}`, rss);
  return stories.length;
}

async function alerts() {
  const falseMatch1 = must(holder(demo, publics[4]!.id, "CEO"), "CEO for a false name match");
  const falseMatch2 = must(holder(demo, peBacked[2]!.id, "CFO"), "CFO for a false name match");
  const quoted = must(holder(demo, publics[1]!.id, "CEO"), "CEO quoted");
  const rumour = must(holder(demo, peBacked[6]!.id, "CEO"), "CEO rumoured to leave");
  const n = "https://news.example.net";
  const g = (url: string) => `https://www.google.com/url?rct=j&amp;sa=t&amp;url=${encodeURIComponent(url)}&amp;ct=ga&amp;usg=AOvVaw0example`;
  const bold = (s: string) => `&lt;b&gt;${esc(s)}&lt;/b&gt;`;

  const entries = [
    // Two false name matches (acceptance scenario 3): same name, different person, no tracked company.
    { id: "a01", daysAgo: 1, url: `${n}/sports/coach`, title: `${bold(falseMatch1.person.fullName)} leads Westfield High to state title`, body: `Coach ${bold(falseMatch1.person.fullName)} guided the Westfield High School football team to its first state championship in a decade.` },
    { id: "a02", daysAgo: 2, url: `${n}/arts/gallery`, title: `Local painter ${bold(falseMatch2.person.fullName)} opens retrospective`, body: `The painter ${bold(falseMatch2.person.fullName)} opened a retrospective at a small gallery on the coast.` },
    // Mentions of tracked companies and people.
    { id: "a03", daysAgo: 1, url: `${n}/business/earnings`, title: `${bold(publics[1]!.name)} beats estimates as ${esc(quoted.person.fullName)} outlines growth plan`, body: `${esc(quoted.person.fullName)}, chief executive of ${esc(publics[1]!.name)}, said the company would invest in new markets.` },
    { id: "a04", daysAgo: 3, url: `${n}/business/rumour`, title: `${bold(rumour.person.fullName)} said to be weighing exit from ${esc(peBacked[6]!.name)}`, body: `People familiar with the matter said ${esc(rumour.person.fullName)} is considering leaving ${esc(peBacked[6]!.name)}. The company declined to comment.` },
    { id: "a05", daysAgo: 4, url: `${n}/business/office`, title: `${bold(publics[3]!.name)} opens new headquarters`, body: `${esc(publics[3]!.name)} moved into a new headquarters building downtown.` },
    { id: "a06", daysAgo: 2, url: `${n}/business/appointment-repeat`, title: `${bold(peBacked[0]!.name)} appoints new chief executive`, body: `${esc(peBacked[0]!.name)} named a new chief executive this week, according to a company statement.` },
    { id: "a07", daysAgo: 5, url: `${n}/business/layoffs`, title: `${bold(publics[13]!.name)} restructuring to cut jobs`, body: `${esc(publics[13]!.name)} will cut about 8 percent of its workforce.` },
    { id: "a08", daysAgo: 6, url: `${n}/business/hiring`, title: `${bold(peBacked[4]!.name)} hiring surge in technology roles`, body: `${esc(peBacked[4]!.name)} has posted more than 60 technology roles this month.` },
    { id: "a09", daysAgo: 7, url: `${n}/business/award`, title: `${bold(peBacked[7]!.name)} wins workplace award`, body: `${esc(peBacked[7]!.name)} was recognised as a top workplace in its region.` },
    // Noise.
    { id: "a10", daysAgo: 1, url: `${n}/weather`, title: "Storm expected to bring heavy rain", body: "Forecasters expect heavy rain across the region this weekend." },
    { id: "a11", daysAgo: 2, url: `${n}/tech/phones`, title: "New phones announced at trade show", body: "Several manufacturers announced new phones at a trade show." },
    { id: "a12", daysAgo: 3, url: `${n}/markets`, title: "Markets close higher on rate hopes", body: "Stocks closed higher as investors weighed the outlook for interest rates." },
    { id: "a13", daysAgo: 4, url: `${n}/local/park`, title: "City approves new park", body: "The city council approved plans for a new park." },
    { id: "a14", daysAgo: 5, url: `${n}/travel`, title: "Airline adds routes for winter", body: "An airline added new routes for the winter season." },
    { id: "a15", daysAgo: 6, url: `${n}/food`, title: "Restaurant week returns", body: "Restaurant week returns with discounted menus across the city." },
  ];

  const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:idx="urn:atom-extension:indexing">
<id>tag:google.com,2005:reader/user/00000000000000000000/state/com.google/alerts/0000000000000000000</id>
<title>Google Alert - tracked executives (demo)</title>
<link href="https://www.google.com/alerts/feeds/00000000000000000000/0000000000000000000" rel="self"></link>
<updated>{{datetime:0}}</updated>
${entries
  .map(
    (e) => `<entry>
<id>tag:google.com,2013:googlealerts/feed:demo-${e.id}</id>
<title type="html">${e.title}</title>
<link href="${g(e.url)}"></link>
<published>{{datetime:-${e.daysAgo}}}</published>
<updated>{{datetime:-${e.daysAgo}}}</updated>
<content type="html">${e.body}</content>
<author><name></name></author>
</entry>`,
  )
  .join("\n")}
</feed>`;
  await put(`alerts/${fixtureNameForUrl("https://alerts.example.net/feeds/demo-executives")}`, atom);
  return entries.length;
}

// ---------------------------------------------------------------------------------------------
// Leadership pages: every company has a page; four change between captures
// ---------------------------------------------------------------------------------------------

async function pages() {
  function page(w: WorkspaceBundle, company: Company, change?: { add?: string[]; remove?: string[]; retitle?: [string, string] }) {
    const people = currentRoles(w, company.id).map((r) => ({ name: personById.get(r.personId)!.fullName, title: r.title, board: r.seatType === "board" }));
    let leaders = people.filter((p) => !p.board).map((p) => [p.name, p.title] as [string, string]);
    let board = people.filter((p) => p.board).map((p) => [p.name, p.title] as [string, string]);
    if (change?.remove) {
      leaders = leaders.filter(([n]) => !change.remove!.includes(n));
      board = board.filter(([n]) => !change.remove!.includes(n));
    }
    if (change?.retitle) leaders = leaders.map(([n, t]) => (n === change.retitle![0] ? [n, change.retitle![1]] : [n, t]));
    const added = (change?.add ?? []).map((line) => line.split("|") as [string, string]);
    const section = (title: string, rows: [string, string][]) =>
      `<section><h2>${title}</h2>${rows.map(([n, t]) => `<div class="person"><h3>${esc(n)}</h3><p>${esc(t)}</p></div>`).join("")}</section>`;
    return `<!DOCTYPE html><html><head><title>Leadership | ${esc(company.name)}</title><script>window.analytics = {};</script></head><body>
<nav><a href="/">Home</a> <a href="/about">About</a> <a href="/leadership">Leadership</a></nav>
<main><h1>Our leadership</h1>
${section("Executive team", [...leaders, ...added.filter(([, t]) => !/director|chair/i.test(t))])}
${section("Board of directors", [...board, ...added.filter(([, t]) => /director|chair/i.test(t))])}
</main><footer><p>Copyright ${esc(company.name)}. All rights reserved.</p></footer></body></html>`;
  }

  let changed = 0;
  const changes = new Map<string, Parameters<typeof page>[2]>();
  const t1 = publics[0]!;
  changes.set(t1.id, { remove: [must(holder(demo, t1.id, "CFO"), "CFO").person.fullName] });
  const t2 = peBacked[1]!;
  changes.set(t2.id, { add: [`${OUTSIDERS[4]}|Chief Human Resources Officer`] });
  const t3 = publics[4]!;
  changes.set(t3.id, { add: [`${OUTSIDERS[5]}|Independent Director`] });
  const t4 = peBacked[2]!;
  const promoted = must(holder(demo, t4.id, "COO") ?? holder(demo, t4.id, "CHRO"), "officer to promote");
  changes.set(t4.id, { retitle: [promoted.person.fullName, "President and Chief Operating Officer"] });

  for (const w of all) {
    for (const company of w.companies) {
      for (const url of company.leadershipPageUrls ?? []) {
        const u = new URL(url);
        const base = `pages/${u.host}${u.pathname}`;
        await put(`${base}.before.html`, page(w, company));
        const change = changes.get(company.id);
        if (change) {
          const html = page(w, company, change);
          await put(`${base}.after.html`, html);
          CHANGED_PAGES.set(company.id, { url, html });
          changed++;
        }
      }
    }
  }
  // One site disallows the platform's crawler, so robots.txt handling is exercised.
  const blocked = privates[7]!;
  await put(`pages/${new URL(blocked.leadershipPageUrls![0]!).host}/robots.txt`, "User-agent: BEAMIntelligence\nDisallow: /\n\nUser-agent: *\nAllow: /\n");
  return changed;
}

// ---------------------------------------------------------------------------------------------
// Apollo: 30 people (3 job changes, 2 guessed emails) and every organization
// ---------------------------------------------------------------------------------------------

async function apollo() {
  const withEmail = demo.persons
    .map((p) => ({ p, role: demo.roles.find((r) => r.personId === p.id && r.isPrimary && r.businessEmail && r.seatType === "executive") }))
    .filter((x): x is { p: Person; role: WorkspaceBundle["roles"][number] } => !!x.role)
    .slice(0, 30);
  if (withEmail.length < 30) throw new Error("Seed has fewer than 30 executives with email.");
  const offListCompany = { id: "apollo-org-offlist", name: "Vantage Example Partners", primary_domain: "vantage-partners.example.com", estimated_num_employees: 900, industry: "Business services" };

  const people = withEmail.map(({ p, role }, i) => {
    const company = companyById.get(role.companyId)!;
    const [firstName, ...rest] = p.fullName.split(" ");
    let title = role.title;
    let organization = { id: `apollo-org-${company.domain}`, name: company.name, primary_domain: company.domain, estimated_num_employees: company.employeeCount, industry: company.industry };
    // Three job changes: to another tracked company, to a company off the list, and a promotion.
    if (i === 3) {
      const target = publics[14]!;
      organization = { id: `apollo-org-${target.domain}`, name: target.name, primary_domain: target.domain, estimated_num_employees: target.employeeCount, industry: target.industry };
      title = "Chief Operating Officer";
    }
    if (i === 7) {
      organization = offListCompany;
      title = "Chief Financial Officer";
    }
    if (i === 11) title = role.titleNormalised === "CEO" ? "Executive Chair" : "President";
    return {
      id: `apollo-person-${i + 1}`,
      first_name: firstName,
      last_name: rest.join(" "),
      name: p.fullName,
      title,
      email: role.businessEmail,
      // Two guessed emails: stored as guessed and never used for sending.
      email_status: i === 5 || i === 9 ? "guessed" : "verified",
      linkedin_url: p.linkedinUrl,
      city: p.city,
      state: p.region,
      country: p.country === "US" ? "United States" : p.country,
      organization,
      employment_history: [{ organization_name: organization.name, title, start_date: role.effectiveOn, end_date: null, current: true }],
    };
  });
  await put("apollo/people.json", json(people));

  const orgs: Record<string, unknown> = {};
  for (const c of all.flatMap((w) => w.companies)) {
    if (!c.domain) continue;
    orgs[c.domain] = { id: `apollo-org-${c.domain}`, name: c.name, primary_domain: c.domain, website_url: `https://${c.domain}`, estimated_num_employees: c.employeeCount ? Math.round(c.employeeCount * 1.04) : null, industry: c.industry?.toLowerCase() ?? null, country: c.hqCountry === "US" ? "United States" : c.hqCountry };
  }
  await put("apollo/organizations.json", json(orgs));
  return people.length;
}

// ---------------------------------------------------------------------------------------------
// Newsletter events CSV
// ---------------------------------------------------------------------------------------------

async function newsletter() {
  const emails = demo.roles.filter((r) => r.isPrimary && r.businessEmail && r.emailStatus === "verified").map((r) => r.businessEmail!);
  const [e1, e2, e3, e4, e5] = emails;
  const rows = [
    "email,event,occurred_at,issue_title,link_url,topics",
    // Three clicks on one topic within 30 days: a first-party interest.
    `${e1},click,{{datetime:-20}},Board refresh season,https://demo-search.example.com/insights/board-refresh,Board composition`,
    `${e1},click,{{datetime:-12}},Succession in practice,https://demo-search.example.com/insights/succession,CEO succession; Board composition`,
    `${e1},click,{{datetime:-3}},What boards ask first,https://demo-search.example.com/insights/first-100-days,Board composition`,
    `${e1},open,{{datetime:-3}},What boards ask first,,`,
    `${e2},click,{{datetime:-8}},The CFO agenda,https://demo-search.example.com/insights/cfo-agenda,CFO agenda`,
    `${e2},open,{{datetime:-8}},The CFO agenda,,`,
    `${e3},open,{{datetime:-5}},Board refresh season,,`,
    `${e4},click,{{datetime:-15}},Five questions for a new CHRO,https://demo-search.example.com/insights/chro,CHRO agenda`,
    // One unsubscribe.
    `${e5},unsubscribe,{{datetime:-2}},Board refresh season,,`,
    // One subscriber who is not a tracked person: ignored.
    `reader@unrelated.example.net,subscribe,{{datetime:-1}},,,`,
    `reader@unrelated.example.net,click,{{datetime:-1}},The CFO agenda,https://demo-search.example.com/insights/cfo-agenda,CFO agenda`,
  ];
  await put("newsletter/events.csv", rows.join("\n"));
  return rows.length - 1;
}

async function release3() {
  for (const key of ["licensed", "news_api", "warn", "job_postings"]) await put(`${key}/items.json`, "[]");
}


// ---------------------------------------------------------------------------------------------
// AI extraction outputs for mock mode (BRD 21: "AI extraction outputs for every raw item")
// ---------------------------------------------------------------------------------------------

interface Extraction {
  is_relevant: boolean;
  signal_type: string | null;
  subject_kind: "person" | "company" | null;
  person_name: string | null;
  company_name: string | null;
  match_confidence: number;
  new_title: string | null;
  previous_title: string | null;
  event_date: string | null;
  announced_date: string | null;
  effective_date: string | null;
  headline: string;
  evidence_quote: string;
}

const NOT_RELEVANT: Extraction = { is_relevant: false, signal_type: null, subject_kind: null, person_name: null, company_name: null, match_confidence: 0, new_title: null, previous_title: null, event_date: null, announced_date: null, effective_date: null, headline: "", evidence_quote: "" };

function ex(o: Partial<Extraction> & Pick<Extraction, "signal_type" | "headline" | "evidence_quote">): Extraction {
  return { ...NOT_RELEVANT, is_relevant: true, match_confidence: 0.93, subject_kind: o.person_name ? "person" : "company", ...o };
}

/** The first sentence of a body: a verbatim evidence quote. */
const firstSentence = (body: string) => {
  const end = body.indexOf(". ");
  return (end === -1 ? body : body.slice(0, end + 1)).slice(0, 300);
};

const d = (days: number) => `{{date:${days >= 0 ? "+" : ""}${days}}}`;
const rssId = (feedUrl: string, entryId: string, key: string) => `${key}:${createHash("sha256").update(`${feedUrl}|${entryId}`).digest("hex").slice(0, 32)}`;

async function aiFixtures() {
  const out = new Map<string, Extraction>();
  const [p0, p1, , p3, p4, p5, p6, p7, p8] = publics;

  // SEC 8-K Item 5.02, in the order of the filings list.
  const cfo0 = must(holder(demo, p0!.id, "CFO"), "CFO");
  const mover = must(holder(demo, publics[9]!.id, "CFO") ?? holder(demo, publics[10]!.id, "CFO"), "mover");
  const ceo3 = must(holder(demo, p3!.id, "CEO"), "CEO");
  const chro5 = must(holder(demo, p5!.id, "CHRO"), "CHRO");
  const cto7 = holder(demo, p7!.id, "CTO") ?? must(holder(demo, p7!.id, "CHRO"), "officer");
  const chair8 = demo.roles.find((r) => r.companyId === p8!.id && r.titleNormalised === "Chair" && r.status === "current");
  const boardSeatCompany = companyById.get(multiBoardPublicSeat.companyId)!;
  const secSpecs: Extraction[] = [
    ex({ signal_type: "person_left", person_name: cfo0.person.fullName, company_name: p0!.name, match_confidence: 0.96, previous_title: "Chief Financial Officer", event_date: d(-2), announced_date: d(-1), effective_date: d(14), headline: `${cfo0.person.fullName} to resign as Chief Financial Officer of ${p0!.name}`, evidence_quote: "" }),
    ex({ signal_type: "person_move_announced", person_name: mover.person.fullName, company_name: p1!.name, match_confidence: 0.95, new_title: "Chief Financial Officer", previous_title: mover.role.title, event_date: d(-3), announced_date: d(-3), effective_date: d(30), headline: `${mover.person.fullName} appointed Chief Financial Officer of ${p1!.name}`, evidence_quote: "" }),
    ex({ signal_type: "person_board_change", person_name: multiBoard.fullName, company_name: boardSeatCompany.name, match_confidence: 0.95, previous_title: multiBoardPublicSeat.title, event_date: d(-5), announced_date: d(-5), effective_date: d(20), headline: `${multiBoard.fullName} will retire from the ${boardSeatCompany.name} board`, evidence_quote: "" }),
    ex({ signal_type: "person_left", person_name: ceo3.person.fullName, company_name: p3!.name, match_confidence: 0.95, previous_title: "Chief Executive Officer", event_date: d(-6), announced_date: d(-6), effective_date: d(60), headline: `${ceo3.person.fullName} to retire as Chief Executive Officer of ${p3!.name}`, evidence_quote: "" }),
    ex({ signal_type: "other", company_name: p4!.name, match_confidence: 0.9, new_title: "Independent Director", event_date: d(-8), announced_date: d(-8), headline: `${p4!.name} elects ${OUTSIDERS[0]} as an independent director`, evidence_quote: "" }),
    ex({ signal_type: "person_left", person_name: chro5.person.fullName, company_name: p5!.name, match_confidence: 0.95, previous_title: "Chief Human Resources Officer", event_date: d(-9), announced_date: d(-9), effective_date: d(-1), headline: `${chro5.person.fullName} steps down as Chief Human Resources Officer of ${p5!.name}`, evidence_quote: "" }),
    ex({ signal_type: "person_left", person_name: cfo0.person.fullName, company_name: p0!.name, match_confidence: 0.95, previous_title: "Chief Financial Officer", event_date: d(-2), announced_date: d(-1), effective_date: d(10), headline: `${cfo0.person.fullName}'s resignation as ${p0!.name} CFO now effective earlier`, evidence_quote: "" }),
    ex({ signal_type: "company_cxo_change", company_name: p6!.name, match_confidence: 0.93, new_title: "Chief Operating Officer", event_date: d(-12), announced_date: d(-12), effective_date: d(7), headline: `${p6!.name} appoints ${OUTSIDERS[1]} as Chief Operating Officer`, evidence_quote: "" }),
    ex({ signal_type: "person_left", person_name: cto7.person.fullName, company_name: p7!.name, match_confidence: 0.95, previous_title: cto7.role.title, event_date: d(-14), announced_date: d(-14), effective_date: d(-4), headline: `${cto7.person.fullName} resigns as ${cto7.role.title} of ${p7!.name}`, evidence_quote: "" }),
    chair8
      ? ex({ signal_type: "person_board_change", person_name: personById.get(chair8.personId)!.fullName, company_name: p8!.name, match_confidence: 0.88, previous_title: "Chair of the Board", event_date: d(-16), announced_date: d(-16), headline: `${personById.get(chair8.personId)!.fullName} steps down as Chair of ${p8!.name} and stays a director`, evidence_quote: "" })
      : ex({ signal_type: "other", company_name: p8!.name, match_confidence: 0.9, new_title: "Chair of the Board", event_date: d(-16), headline: `${p8!.name} elects ${OUTSIDERS[2]} as Chair of the Board`, evidence_quote: "" }),
  ];
  secSpecs.forEach((spec, i) => out.set(`sec:${SEC_ACCESSIONS[i]}`, { ...spec, evidence_quote: firstSentence(SEC_FILINGS[i]!.body.replace(/^\([a-z]\)\s*/, "")) }));

  // Wires.
  const feed = "https://wire.example.net/rss/appointments";
  const pe0 = peBacked[0]!;
  const joiner = must(holder(demo, publics[11]!.id, "COO") ?? holder(demo, publics[11]!.id, "CFO"), "joiner");
  const glenmara = demo.companies.find((c) => c.hqCountry === "DE")!;
  const german = demo.persons.find((p) => p.country === "DE" && demo.consents.some((c) => c.personId === p.id && c.channel === "email" && c.status === "unknown"))!;
  const client = clients[0]!;
  const clientExec = must(holder(demo, client.id, "CFO"), "client CFO");
  const award = must(holder(demo, publics[2]!.id, "CFO"), "award");
  const speaker = must(holder(demo, peBacked[1]!.id, "CEO"), "speaker");
  const joined = (conf: number, days: number) => ex({ signal_type: "person_joined", person_name: joiner.person.fullName, company_name: pe0.name, match_confidence: conf, new_title: "Chief Executive Officer", previous_title: joiner.role.title, event_date: d(-days), headline: `${joiner.person.fullName} joins ${pe0.name} as Chief Executive Officer`, evidence_quote: "" });
  const wireSpecs: Record<string, [Extraction, string]> = {
    "wire-1001": [joined(0.9, 2), `${pe0.name}, a portfolio company of ${sponsors[0]!.name}, today announced that ${joiner.person.fullName} has joined the company as Chief Executive Officer.`],
    "wire-1002": [joined(0.9, 2), `${sponsors[0]!.name} portfolio company ${pe0.name} has appointed ${joiner.person.fullName} as its new chief executive, effective immediately.`],
    "wire-1003": [joined(0.88, 1), `${pe0.name} said ${joiner.person.fullName} has been appointed Chief Executive Officer.`],
    "wire-1004": [ex({ signal_type: "person_promotion", person_name: german.fullName, company_name: glenmara.name, match_confidence: 0.92, new_title: "Chief Operating Officer", event_date: d(-3), headline: `${german.fullName} promoted to Chief Operating Officer of ${glenmara.name}`, evidence_quote: "" }), `${glenmara.name} announced that ${german.fullName} has been promoted to Chief Operating Officer, with responsibility for plants in Bavaria and Saxony.`],
    "wire-1005": [ex({ signal_type: "person_left", person_name: clientExec.person.fullName, company_name: client.name, match_confidence: 0.92, previous_title: "Chief Financial Officer", event_date: d(-4), headline: `${clientExec.person.fullName} to leave ${client.name}`, evidence_quote: "" }), `${client.name} announced that Chief Financial Officer ${clientExec.person.fullName} will leave the company at the end of the quarter.`],
    "wire-1006": [ex({ signal_type: "company_pe_transaction", company_name: peBacked[5]!.name, event_date: d(-5), headline: `${sponsors[1]!.name} to acquire a majority stake in ${peBacked[5]!.name}`, evidence_quote: "" }), `${sponsors[1]!.name} has signed a definitive agreement to acquire a majority stake in ${peBacked[5]!.name} from ${sponsors[2]!.name}.`],
    "wire-1007": [ex({ signal_type: "company_funding_ipo", company_name: privates[4]!.name, event_date: d(-6), headline: `${privates[4]!.name} raises $85 million Series C`, evidence_quote: "" }), `${privates[4]!.name} today announced an $85 million Series C financing to expand its manufacturing capacity and grow its leadership team.`],
    "wire-1008": [ex({ signal_type: "company_mna", company_name: publics[6]!.name, event_date: d(-7), headline: `${publics[6]!.name} to acquire ${privates[2]!.name}`, evidence_quote: "" }), `${publics[6]!.name} announced it will acquire ${privates[2]!.name} in an all-cash transaction expected to close next quarter.`],
    "wire-1009": [ex({ signal_type: "company_layoffs", company_name: publics[13]!.name, event_date: d(-8), headline: `${publics[13]!.name} to cut about 8 percent of its workforce`, evidence_quote: "" }), `${publics[13]!.name} will reduce its workforce by about 8 percent as part of a restructuring plan.`],
    "wire-1010": [ex({ signal_type: "company_expansion", company_name: peBacked[3]!.name, event_date: d(-9), headline: `${peBacked[3]!.name} opens European headquarters`, evidence_quote: "" }), `${peBacked[3]!.name} opened its first European headquarters in Amsterdam and plans to hire a regional leadership team.`],
    "wire-1011": [ex({ signal_type: "person_award", person_name: award.person.fullName, company_name: publics[2]!.name, event_date: d(-10), headline: `${award.person.fullName} named to a list of 50 finance leaders`, evidence_quote: "" }), `${award.person.fullName}, Chief Financial Officer of ${publics[2]!.name}, was named to this year's list of 50 finance leaders to watch.`],
    "wire-1012": [ex({ signal_type: "person_speaking", person_name: speaker.person.fullName, company_name: peBacked[1]!.name, event_date: d(21), headline: `${speaker.person.fullName} to keynote the Portfolio Leadership Summit`, evidence_quote: "" }), `${speaker.person.fullName}, Chief Executive Officer of ${peBacked[1]!.name}, will deliver the opening keynote at the Portfolio Leadership Summit in Chicago on ${d(21)}.`],
    "wire-1013": [ex({ signal_type: "company_product_partnership", company_name: publics[8]!.name, event_date: d(-12), headline: `${publics[8]!.name} and ${publics[9]!.name} announce a partnership`, evidence_quote: "" }), `${publics[8]!.name} and ${publics[9]!.name} announced a strategic partnership to integrate their platforms.`],
    "wire-1014": [ex({ signal_type: "company_cxo_change", company_name: publics[12]!.name, match_confidence: 0.94, new_title: "Chief Financial Officer", event_date: d(-2), effective_date: d(15), headline: `${publics[12]!.name} appoints ${OUTSIDERS[3]} Chief Financial Officer`, evidence_quote: "" }), `${publics[12]!.name} today announced the appointment of ${OUTSIDERS[3]} as Chief Financial Officer, effective ${d(15)}.`],
  };
  for (const [guid, [spec, quote]] of Object.entries(wireSpecs)) out.set(rssId(feed, guid, "press_wire"), { ...spec, evidence_quote: quote });

  // Google Alerts.
  const alertFeed = "https://alerts.example.net/feeds/demo-executives";
  const rumour = must(holder(demo, peBacked[6]!.id, "CEO"), "rumour");
  const alertSpecs: Record<string, Extraction> = {
    a03: NOT_RELEVANT,
    a04: ex({ signal_type: "person_left", person_name: rumour.person.fullName, company_name: peBacked[6]!.name, match_confidence: 0.7, previous_title: "Chief Executive Officer", event_date: d(-3), headline: `${rumour.person.fullName} reported to be weighing an exit from ${peBacked[6]!.name}`, evidence_quote: `People familiar with the matter said ${rumour.person.fullName} is considering leaving ${peBacked[6]!.name}.` }),
    a05: NOT_RELEVANT,
    a06: ex({ signal_type: "company_cxo_change", company_name: pe0.name, match_confidence: 0.7, event_date: d(-2), headline: `${pe0.name} names a new chief executive`, evidence_quote: `${pe0.name} named a new chief executive this week, according to a company statement.` }),
    a07: ex({ signal_type: "company_layoffs", company_name: publics[13]!.name, event_date: d(-5), headline: `${publics[13]!.name} restructuring to cut jobs`, evidence_quote: `${publics[13]!.name} will cut about 8 percent of its workforce.` }),
    a08: ex({ signal_type: "company_hiring_surge", company_name: peBacked[4]!.name, event_date: d(-6), headline: `${peBacked[4]!.name} posts more than 60 technology roles`, evidence_quote: `${peBacked[4]!.name} has posted more than 60 technology roles this month.` }),
    a09: NOT_RELEVANT,
  };
  for (const [id, spec] of Object.entries(alertSpecs)) out.set(rssId(alertFeed, `tag:google.com,2013:googlealerts/feed:demo-${id}`, "google_alert"), spec);

  // Leadership page diffs.
  const t1 = publics[0]!;
  const t2 = peBacked[1]!;
  const t3 = publics[4]!;
  const t4 = peBacked[2]!;
  const promoted = must(holder(demo, t4.id, "COO") ?? holder(demo, t4.id, "CHRO"), "promoted");
  const pageSpecs: [Company, Extraction][] = [
    [t1, ex({ signal_type: "person_left", person_name: cfo0.person.fullName, company_name: t1.name, match_confidence: 0.92, previous_title: "Chief Financial Officer", event_date: d(0), headline: `${cfo0.person.fullName} no longer listed on the ${t1.name} leadership page`, evidence_quote: cfo0.person.fullName })],
    [t2, ex({ signal_type: "company_cxo_change", company_name: t2.name, match_confidence: 0.92, new_title: "Chief Human Resources Officer", event_date: d(0), headline: `${t2.name} lists ${OUTSIDERS[4]} as Chief Human Resources Officer`, evidence_quote: OUTSIDERS[4]! })],
    [t3, ex({ signal_type: "other", company_name: t3.name, match_confidence: 0.9, new_title: "Independent Director", event_date: d(0), headline: `${t3.name} lists ${OUTSIDERS[5]} as an independent director`, evidence_quote: OUTSIDERS[5]! })],
    [t4, ex({ signal_type: "person_promotion", person_name: promoted.person.fullName, company_name: t4.name, match_confidence: 0.93, new_title: "President and Chief Operating Officer", previous_title: promoted.role.title, event_date: d(0), headline: `${promoted.person.fullName} now listed as President and Chief Operating Officer of ${t4.name}`, evidence_quote: "President and Chief Operating Officer" })],
  ];
  for (const [company, spec] of pageSpecs) {
    const changed = CHANGED_PAGES.get(company.id);
    if (!changed) throw new Error(`No changed page for ${company.name}`);
    out.set(`page:${hashText(changed.url)}:${hashText(htmlToLines(changed.html).join("\n"))}`, spec);
  }

  for (const [externalId, spec] of out) await put(fixtureFileForExternalId(externalId), json(spec));
  return out.size;
}

// ---------------------------------------------------------------------------------------------
// Capture (BRD 11.1): mailbox deltas and calendars for the demo users' mock connections
// ---------------------------------------------------------------------------------------------

/**
 * Jordan's first mailbox delta has exactly 50 messages, of which 4 involve tracked people
 * (acceptance scenario 11): one inbound, one outbound, one with a tracked person only on copy,
 * and one to a tracked person's past address. The other 46 are internal mail, newsletters,
 * vendors and personal mail on reserved example domains. Priya's has 8, 2 of them tracked.
 */
async function capture(): Promise<Record<string, number>> {
  const userEmail = (name: string) => bundle.users.find((u) => u.name === name)!.email;
  const jordan = userEmail("Jordan Ellis");
  const priya = userEmail("Priya Raman");
  const used = new Set<string>();
  const trackedEmail = (pred: (r: WorkspaceBundle["roles"][number]) => boolean) => {
    const r = must(demo.roles.find((x) => x.businessEmail && !used.has(x.personId) && pred(x)), "tracked email");
    used.add(r.personId);
    return { email: r.businessEmail!, person: personById.get(r.personId)! };
  };
  const current = (r: WorkspaceBundle["roles"][number]) => r.status === "current" && r.seatType === "executive";
  const a = trackedEmail(current);
  const b = trackedEmail(current);
  const c = trackedEmail(current);
  const past = trackedEmail((r) => r.status === "ended");
  const first = (p: Person) => p.fullName.split(" ")[0];
  let n = 0;
  const msg = (daysAgo: number, from: string, to: string[], cc: string[], subject: string, conversation: string) => ({
    id: `mock-${++n}`,
    internetMessageId: `<mock-${n}.${daysAgo}@mail.example.net>`,
    conversationId: `conv-${conversation}`,
    sentAt: `{{datetime:-${daysAgo}}}`,
    from,
    to,
    cc,
    subject,
  });
  const tracked = [
    msg(2, a.email, [jordan], [], `Re: Board dinner next month`, "a1"),
    msg(3, jordan, [b.email], [], `Following up on our conversation`, "b1"),
    msg(4, "office@harcourt-legal.example.net", [jordan], [c.email], `Introductions ahead of the ${first(c.person)} meeting`, "c1"),
    msg(6, jordan, [past.email, "assistant@example.org"], [], `Catching up`, "p1"),
  ];
  const colleagues = ["lee.whitford@demo-search.example.com", "priya.raman@markivis.example.com", "finance@demo-search.example.com", "it-help@demo-search.example.com"];
  const others = ["digest@news.example.net", "events@conference.example.org", "billing@software.example.com", "sam.family@family.example.net", "concierge@travel.example.com", "noreply@bank.example.net", "hello@newsletter.example.org"];
  const topics = ["Weekly market brief", "Your invoice is ready", "Team offsite logistics", "Travel itinerary", "Dinner on Saturday?", "Quarterly numbers draft", "Password reset", "Webinar reminder", "Expense report", "Holiday schedule", "Printer is fixed", "Reading list"];
  const untracked = Array.from({ length: 46 }, (_, i) => {
    const outsider = i % 2 === 0 ? colleagues[i % colleagues.length]! : others[i % others.length]!;
    const outbound = i % 5 === 0;
    return msg(1 + (i % 28), outbound ? jordan : outsider, outbound ? [outsider] : [jordan], i % 7 === 0 ? [colleagues[(i + 1) % colleagues.length]!] : [], `${topics[i % topics.length]} ${i + 1}`, `u${i}`);
  });
  // Interleave, so the tracked messages are not simply first.
  const mail = [...untracked.slice(0, 11), tracked[0]!, ...untracked.slice(11, 23), tracked[1]!, ...untracked.slice(23, 34), tracked[2]!, ...untracked.slice(34), tracked[3]!];
  await put(`capture/microsoft/${jordan}/mail.json`, json({ messages: mail }));

  const d = trackedEmail(current);
  const e = trackedEmail(current);
  await put(`capture/microsoft/${jordan}/calendar.json`, json({
    events: [
      { id: "mock-event-1", title: `Coffee with ${first(d.person)}`, startsAt: "{{datetime:-5}}", endsAt: "{{datetime:-5}}", organizer: jordan, attendees: [jordan, d.email], cancelled: false },
      { id: "mock-event-2", title: `Call: ${e.person.fullName}`, startsAt: "{{datetime:3}}", endsAt: "{{datetime:3}}", organizer: e.email, attendees: [jordan, e.email], cancelled: false },
      { id: "mock-event-3", title: "Partners' weekly", startsAt: "{{datetime:-2}}", endsAt: "{{datetime:-2}}", organizer: jordan, attendees: [jordan, ...colleagues.slice(0, 2)], cancelled: false },
      { id: "mock-event-4", title: `Lunch with ${first(a.person)}`, startsAt: "{{datetime:-8}}", endsAt: "{{datetime:-8}}", organizer: jordan, attendees: [jordan, a.email], cancelled: true },
    ],
  }));

  const f = trackedEmail(current);
  const g = trackedEmail(current);
  n = 100;
  await put(`capture/microsoft/${priya}/mail.json`, json({
    messages: [
      msg(1, priya, [f.email], [], "Scheduling a call with Jordan", "f1"),
      msg(2, g.email, [priya], [], "Re: Request for time", "g1"),
      ...Array.from({ length: 6 }, (_, i) => msg(1 + i, i % 2 ? priya : colleagues[i % colleagues.length]!, i % 2 ? [others[i]!] : [priya], [], `${topics[i]} (Priya)`, `pu${i}`)),
    ],
  }));
  await put(`capture/microsoft/${priya}/calendar.json`, json({ events: [] }));
  return { jordan_messages: mail.length, jordan_tracked: tracked.length };
}

async function main() {
  for (const dir of ["sec", "wires", "alerts", "pages", "apollo", "newsletter", "licensed", "news_api", "warn", "job_postings", "ai", "capture"]) await rm(path.join(ROOT, dir), { recursive: true, force: true });
  const counts = { sec_502_filings: await sec(), wire_items: await wires(), alert_items: await alerts(), pages_changed: await pages(), apollo_people: await apollo(), newsletter_events: await newsletter() };
  await release3();
  console.log({ ...counts, ai_extractions: await aiFixtures(), capture: await capture() });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
