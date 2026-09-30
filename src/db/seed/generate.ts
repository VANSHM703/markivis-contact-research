/**
 * Deterministic seed data (BRD 21). Pure: returns rows with pre-generated IDs and inserts nothing.
 * The same `now` always produces the same data, apart from dates, which are relative to `now`.
 */
import type { InferInsertModel, Table } from "drizzle-orm";
import { DEFAULT_FLAGS, DEFAULT_PACKS, DEFAULT_SETTINGS, DEFAULT_TOPICS } from "@/config/workspace-defaults";
import { normaliseCompanyName, normaliseName } from "@/lib/normalise";
import type * as s from "../schema";
import { CONTENT_ITEMS, DEMO_COMPANIES, FIRST_NAMES, HARBOR_COMPANIES, LAST_NAMES, type CompanySeed } from "./names";

type Row<T extends Table> = InferInsertModel<T> & { id: string };

export interface WorkspaceBundle {
  workspace: Row<typeof s.workspaces>;
  members: Row<typeof s.workspaceMembers>[];
  companies: Row<typeof s.companies>[];
  persons: Row<typeof s.persons>[];
  roles: Row<typeof s.roles>[];
  sponsorLinks: Row<typeof s.sponsorLinks>[];
  placements: Row<typeof s.placements>[];
  offLimits: Row<typeof s.offLimits>[];
  contentItems: Row<typeof s.contentItems>[];
  feeds: Row<typeof s.feeds>[];
  interactions: Row<typeof s.interactions>[];
  calendarEvents: Row<typeof s.calendarEvents>[];
  consents: Row<typeof s.consents>[];
  fieldSources: Row<typeof s.fieldSources>[];
  personInterests: Row<typeof s.personInterests>[];
}

export interface SeedBundle {
  users: Row<typeof s.users>[];
  workspaces: WorkspaceBundle[];
}

// ---------------------------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------------------------

class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
  uuid(): string {
    const hex = Array.from({ length: 16 }, () => this.int(0, 255));
    hex[6] = (hex[6]! & 0x0f) | 0x40;
    hex[8] = (hex[8]! & 0x3f) | 0x80;
    const h = hex.map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
}

const DAY = 86_400_000;
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const slugify = (v: string) =>
  normaliseCompanyName(v)
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

// ---------------------------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------------------------

type SeniorityValue = "c_suite" | "board" | "svp" | "vp" | "other";

interface SeatDef {
  title: string;
  norm: string;
  fn: string;
  seniority: SeniorityValue;
}

const EXEC_SEATS: Record<string, SeatDef> = {
  CEO: { title: "Chief Executive Officer", norm: "CEO", fn: "General management", seniority: "c_suite" },
  CFO: { title: "Chief Financial Officer", norm: "CFO", fn: "Finance", seniority: "c_suite" },
  CHRO: { title: "Chief Human Resources Officer", norm: "CHRO", fn: "People", seniority: "c_suite" },
  COO: { title: "Chief Operating Officer", norm: "COO", fn: "Operations", seniority: "c_suite" },
  CTO: { title: "Chief Technology Officer", norm: "CTO", fn: "Technology", seniority: "c_suite" },
};

/** The role someone held before their current seat. */
const PREVIOUS_SEATS: Record<string, SeatDef[]> = {
  CEO: [
    { title: "President", norm: "President", fn: "General management", seniority: "c_suite" },
    EXEC_SEATS.COO!,
  ],
  CFO: [{ title: "SVP, Finance", norm: "SVP", fn: "Finance", seniority: "svp" }, EXEC_SEATS.CFO!],
  CHRO: [{ title: "SVP, People", norm: "SVP", fn: "People", seniority: "svp" }, { title: "VP, Talent", norm: "VP", fn: "People", seniority: "vp" }],
  COO: [{ title: "SVP, Operations", norm: "SVP", fn: "Operations", seniority: "svp" }],
  CTO: [{ title: "VP, Engineering", norm: "VP", fn: "Technology", seniority: "vp" }, { title: "Chief Information Officer", norm: "CIO", fn: "Technology", seniority: "c_suite" }],
};

const DIRECTOR: SeatDef = { title: "Independent Director", norm: "Director", fn: "Board", seniority: "board" };
const CHAIR: SeatDef = { title: "Chair of the Board", norm: "Chair", fn: "Board", seniority: "board" };

const US_CITIES = [
  ["New York", "NY"], ["Boston", "MA"], ["Chicago", "IL"], ["Dallas", "TX"], ["Atlanta", "GA"],
  ["San Francisco", "CA"], ["Denver", "CO"], ["Charlotte", "NC"], ["Minneapolis", "MN"], ["Seattle", "WA"],
] as const;
const FOREIGN_CITY: Record<string, [string, string]> = { DE: ["Munich", "Bavaria"], GB: ["London", "England"] };

const SUBJECTS = ["Catch-up", "Quarterly check-in", "Board succession themes", "Leadership team review", "Coffee next week", "Follow-up from dinner", "Introduction"];

// ---------------------------------------------------------------------------------------------
// Workspace plan
// ---------------------------------------------------------------------------------------------

interface SeedUser {
  key: string;
  name: string;
  email: string;
}

interface WorkspacePlan {
  seed: number;
  name: string;
  slug: string;
  domainSuffix: string;
  allowedDomains: string[];
  companies: readonly CompanySeed[];
  members: { userKey: string; role: InferInsertModel<typeof s.workspaceMembers>["role"] }[];
  execCount: number;
  boardMulti: number;
  boardTriple: number;
  boardSingle: number;
  sponsorPeoplePerSponsor: number;
  endedRoles: number;
  profiles: { strong: number; warm: number; cooling: number; quiet: number; cold: number };
  /** Exact interaction count to hit, or undefined to keep whatever the profiles produce. */
  interactionTotal?: number;
  placements: number;
  calendarEvents: number;
  contentItems: number;
  guessedEmails: number;
  offLimits: boolean;
}

const USERS: SeedUser[] = [
  { key: "partner", name: "Jordan Ellis", email: "jordan.ellis@demo-search.example.com" },
  { key: "outreach", name: "Priya Raman", email: "priya.raman@markivis.example.com" },
  { key: "validator", name: "Sam Okafor", email: "sam.okafor@markivis.example.com" },
  { key: "steward", name: "Lee Whitford", email: "lee.whitford@demo-search.example.com" },
  { key: "harbor_partner", name: "Casey Morgan", email: "casey.morgan@harbor-search.example.org" },
];

export const DEMO_PLAN: WorkspacePlan = {
  seed: 20260930,
  name: "Demo Search Partners",
  slug: "demo-search-partners",
  domainSuffix: "example.com",
  allowedDomains: ["demo-search.example.com"],
  companies: DEMO_COMPANIES,
  members: [
    { userKey: "partner", role: "partner" },
    { userKey: "outreach", role: "outreach_owner" },
    { userKey: "validator", role: "validator" },
    { userKey: "steward", role: "data_steward" },
  ],
  // 150 people = 123 executives + 18 board-only directors + 9 sponsor partners.
  execCount: 123,
  boardMulti: 10, // two concurrent seats
  boardTriple: 2, // three concurrent seats; 10 + 2 = 12 people with two or more
  boardSingle: 6, // one seat, and no LinkedIn URL
  sponsorPeoplePerSponsor: 3,
  // 220 roles = 123 + (10 x 2 + 2 x 3 + 6) + 9 current, plus 56 ended.
  endedRoles: 56,
  profiles: { strong: 12, warm: 20, cooling: 19, quiet: 3, cold: 30 },
  interactionTotal: 600,
  placements: 5,
  calendarEvents: 3,
  contentItems: 8,
  guessedEmails: 2,
  offLimits: true,
};

export const HARBOR_PLAN: WorkspacePlan = {
  seed: 20261001,
  name: "Harbor Search Group",
  slug: "harbor-search-group",
  domainSuffix: "example.org",
  allowedDomains: ["harbor-search.example.org"],
  companies: HARBOR_COMPANIES,
  members: [
    { userKey: "harbor_partner", role: "partner" },
    { userKey: "validator", role: "validator" },
  ],
  execCount: 10,
  boardMulti: 1,
  boardTriple: 0,
  boardSingle: 1,
  sponsorPeoplePerSponsor: 0,
  endedRoles: 3,
  profiles: { strong: 1, warm: 2, cooling: 2, quiet: 0, cold: 2 },
  placements: 1,
  calendarEvents: 1,
  contentItems: 2,
  guessedEmails: 0,
  offLimits: false,
};

// ---------------------------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------------------------

export function generateSeed(now: Date = new Date()): SeedBundle {
  const idRng = new Rng(1);
  const users = USERS.map((u) => ({ id: idRng.uuid(), name: u.name, email: u.email }));
  const userIds = Object.fromEntries(USERS.map((u, i) => [u.key, users[i]!.id]));
  const userEmails = Object.fromEntries(USERS.map((u) => [u.key, u.email]));
  // Different name pools per workspace so the two never share a person.
  const nameOffset = { [DEMO_PLAN.slug]: 0, [HARBOR_PLAN.slug]: 150 };
  return {
    users,
    workspaces: [DEMO_PLAN, HARBOR_PLAN].map((plan) => generateWorkspace(plan, now, userIds, userEmails, nameOffset[plan.slug] ?? 0)),
  };
}

function generateWorkspace(
  plan: WorkspacePlan,
  now: Date,
  userIds: Record<string, string>,
  userEmails: Record<string, string>,
  nameOffset: number,
): WorkspaceBundle {
  const rng = new Rng(plan.seed);
  const workspaceId = rng.uuid();
  const partnerKey = plan.members.find((m) => m.role === "partner")!.userKey;
  const partnerId = userIds[partnerKey]!;
  const memberId = (role: string) => {
    const member = plan.members.find((m) => m.role === role);
    return member ? userIds[member.userKey]! : partnerId;
  };
  const outreachId = memberId("outreach_owner");
  const stewardId = memberId("data_steward");

  const workspace: WorkspaceBundle["workspace"] = {
    id: workspaceId,
    name: plan.name,
    slug: plan.slug,
    timezone: "America/New_York",
    packs: DEFAULT_PACKS,
    flags: DEFAULT_FLAGS,
    settings: DEFAULT_SETTINGS,
    allowedEmailDomains: plan.allowedDomains,
  };

  const members = plan.members.map((m) => ({
    id: rng.uuid(),
    workspaceId,
    userId: userIds[m.userKey]!,
    role: m.role,
    status: "active" as const,
  }));

  // --- Companies ------------------------------------------------------------------------------
  const tierCounters: Record<string, number> = {};
  const tierFor = (kind: CompanySeed["kind"]): number | null => {
    const i = (tierCounters[kind] = (tierCounters[kind] ?? -1) + 1);
    if (plan.slug !== DEMO_PLAN.slug) return kind === "sponsor" || kind === "client" ? null : i === 0 ? 1 : 2;
    if (kind === "public") return i < 5 ? 1 : i < 11 ? 2 : 3;
    if (kind === "pe_backed") return i < 4 ? 1 : i < 9 ? 2 : 3;
    if (kind === "private") return i < 4 ? 2 : 3;
    return null;
  };
  let cikCounter = plan.slug === DEMO_PLAN.slug ? 1000 : 5000;

  const companies = plan.companies.map((c) => {
    const slug = slugify(c.name);
    const domain = `${slug}.${plan.domainSuffix}`;
    const employeeCount =
      c.kind === "public" ? rng.pick([1200, 1800, 3500, 6500, 12000, 24000])
      : c.kind === "pe_backed" ? rng.int(250, 1900)
      : c.kind === "private" ? rng.int(80, 1400)
      : c.kind === "client" ? rng.int(1500, 6000)
      : rng.int(40, 180);
    const sizeBand = employeeCount < 200 ? "lt_200" : employeeCount < 1000 ? "200_999" : employeeCount < 5000 ? "1000_4999" : "5000_plus";
    return {
      id: rng.uuid(),
      workspaceId,
      name: c.name,
      nameNormalised: normaliseCompanyName(c.name),
      aliases: c.ticker ? [c.ticker] : [],
      domain,
      secCik: c.kind === "public" ? `99${String(cikCounter++).padStart(8, "0")}` : null,
      ownership: (c.kind === "public" ? "public" : c.kind === "pe_backed" ? "pe_backed" : "private") as "public" | "pe_backed" | "private",
      isSponsor: c.kind === "sponsor",
      hqCountry: c.hqCountry ?? "US",
      hqRegion: c.hqRegion ?? rng.pick(US_CITIES)[1],
      industry: c.industry,
      employeeCount,
      sizeBand: sizeBand as "lt_200" | "200_999" | "1000_4999" | "5000_plus",
      targetTier: tierFor(c.kind),
      clientStatus: (c.kind === "client" ? "client" : c.kind === "sponsor" ? "none" : "prospect") as "client" | "none" | "prospect",
      leadershipPageUrls: c.kind === "sponsor" ? [] : [`https://${domain}/leadership`],
      kind: c.kind,
    };
  });
  const operating = companies.filter((c) => c.kind !== "sponsor");
  const sponsors = companies.filter((c) => c.kind === "sponsor");
  const priorityOrder = [...operating].sort((a, b) => rank(a) - rank(b));
  function rank(c: (typeof companies)[number]): number {
    if (c.kind === "client") return 0;
    return c.targetTier ?? 9;
  }

  // --- People ---------------------------------------------------------------------------------
  const namePairs: [string, string][] = [];
  for (let i = 0; i < FIRST_NAMES.length; i++) {
    for (let j = 0; j < 5; j++) namePairs.push([FIRST_NAMES[i]!, LAST_NAMES[(i * 7 + j * 13) % LAST_NAMES.length]!]);
  }
  const names = new Rng(42).shuffle(namePairs).slice(nameOffset);
  let nameIndex = 0;

  const persons: WorkspaceBundle["persons"] = [];
  const roles: WorkspaceBundle["roles"] = [];
  const primaryRole = new Map<string, WorkspaceBundle["roles"][number]>();
  const personKind = new Map<string, "exec" | "board" | "sponsor">();
  const personSeat = new Map<string, string>();

  function newPerson(companyCountry: string, opts: { linkedin: boolean }) {
    const [first, last] = names[nameIndex++]!;
    const fullName = `${first} ${last}`;
    const [city, region] = FOREIGN_CITY[companyCountry] ?? rng.pick(US_CITIES);
    const person = {
      id: rng.uuid(),
      workspaceId,
      fullName,
      nameNormalised: normaliseName(fullName),
      linkedinUrl: opts.linkedin ? `https://www.linkedin.com/in/example-${first.toLowerCase()}-${last.toLowerCase()}` : null,
      city,
      region,
      country: companyCountry,
      contactTypes: [] as string[],
      relationshipOwnerId: partnerId,
      status: "active" as const,
      isTracked: true,
      isOffList: false,
      isPriority: false,
    };
    persons.push(person);
    return person;
  }

  function emailFor(person: { fullName: string }, company: { domain: string | null }): string {
    const [first, ...rest] = person.fullName.toLowerCase().split(" ");
    return `${first}.${rest.join("")}@${company.domain}`;
  }

  function addRole(
    person: WorkspaceBundle["persons"][number],
    company: (typeof companies)[number],
    seat: SeatDef,
    seatType: "executive" | "board" | "pe_deal_partner" | "pe_operating_partner",
    effective: Date,
    opts: { ended?: Date; email?: boolean; primary?: boolean } = {},
  ) {
    const role = {
      id: rng.uuid(),
      workspaceId,
      personId: person.id,
      companyId: company.id,
      seatType,
      title: seat.title,
      titleNormalised: seat.norm,
      function: seat.fn,
      seniority: seat.seniority,
      businessEmail: opts.email ? emailFor(person, company) : null,
      emailStatus: (opts.email ? "verified" : "unknown") as "verified" | "unknown" | "guessed",
      effectiveOn: isoDate(effective),
      announcedOn: isoDate(addDays(effective, -rng.int(14, 45))),
      endedOn: opts.ended ? isoDate(opts.ended) : null,
      status: (opts.ended ? "ended" : "current") as "ended" | "current",
      isPrimary: opts.primary ?? false,
    };
    roles.push(role);
    if (role.isPrimary) primaryRole.set(person.id, role);
    return role;
  }

  // Executives: CEO and CFO everywhere, then CHRO, then COO and CTO in priority order.
  const seatSlots: [(typeof companies)[number], string][] = [];
  for (const seat of ["CEO", "CFO", "CHRO", "COO", "CTO"]) for (const c of priorityOrder) seatSlots.push([c, seat]);
  for (const [company, seatKey] of seatSlots.slice(0, plan.execCount)) {
    const person = newPerson(company.hqCountry ?? "US", { linkedin: true });
    const yearsIn = seatKey === "CEO" && rng.chance(0.3) ? rng.int(7, 11) : rng.int(1, 6);
    const effective = addDays(now, -(yearsIn * 365 + rng.int(0, 300)));
    addRole(person, company, EXEC_SEATS[seatKey]!, "executive", effective, { email: true, primary: true });
    person.contactTypes = rng.chance(0.25) ? ["prospective_client", "potential_candidate"] : ["prospective_client"];
    person.isPriority = company.targetTier === 1 || company.kind === "client";
    personKind.set(person.id, "exec");
    personSeat.set(person.id, seatKey);
  }

  // Board-only directors, concentrated on tier 1 and 2 companies so shared boards occur.
  const boardCompanies = priorityOrder.filter((c) => c.targetTier === 1 || c.targetTier === 2);
  const chaired = new Set<string>();
  const boardPlan = [
    ...Array<number>(plan.boardTriple).fill(3),
    ...Array<number>(plan.boardMulti).fill(2),
    ...Array<number>(plan.boardSingle).fill(1),
  ];
  boardPlan.forEach((seats, index) => {
    const noLinkedin = seats === 1; // the single-seat directors are the ones without a LinkedIn URL
    const person = newPerson("US", { linkedin: !noLinkedin });
    const picked = rng.shuffle(boardCompanies).slice(0, seats);
    let latest: WorkspaceBundle["roles"][number] | undefined;
    for (const company of picked) {
      const isChair = company.targetTier === 1 && !chaired.has(company.id);
      if (isChair) chaired.add(company.id);
      const effective = addDays(now, -rng.int(400, 3000));
      const role = addRole(person, company, isChair ? CHAIR : DIRECTOR, "board", effective);
      if (!latest || role.effectiveOn > latest.effectiveOn!) latest = role;
    }
    latest!.isPrimary = true;
    primaryRole.set(person.id, latest!);
    person.contactTypes = ["referrer", "prospective_client"];
    person.isPriority = picked.some((c) => c.targetTier === 1) && index % 2 === 0;
    personKind.set(person.id, "board");
  });

  // Sponsor partners.
  for (const sponsor of sponsors) {
    for (let i = 0; i < plan.sponsorPeoplePerSponsor; i++) {
      const person = newPerson("US", { linkedin: true });
      const operatingPartner = i === plan.sponsorPeoplePerSponsor - 1;
      const seat: SeatDef = operatingPartner
        ? { title: "Operating Partner", norm: "Other", fn: "General management", seniority: "other" }
        : { title: "Managing Director", norm: "Other", fn: "General management", seniority: "other" };
      addRole(person, sponsor, seat, operatingPartner ? "pe_operating_partner" : "pe_deal_partner", addDays(now, -rng.int(700, 4000)), { email: true, primary: true });
      person.contactTypes = ["sponsor_contact"];
      personKind.set(person.id, "sponsor");
    }
  }

  // Ended roles: the previous seat of some executives, at another operating company.
  const execs = persons.filter((p) => personKind.get(p.id) === "exec");
  for (const person of rng.shuffle(execs).slice(0, plan.endedRoles)) {
    const current = primaryRole.get(person.id)!;
    const seatKey = personSeat.get(person.id)!;
    const previous = rng.pick(PREVIOUS_SEATS[seatKey]!);
    const company = rng.pick(operating.filter((c) => c.id !== current.companyId));
    const currentStart = new Date(current.effectiveOn!);
    const ended = addDays(currentStart, -rng.int(10, 60));
    const started = addDays(ended, -rng.int(3 * 365, 8 * 365));
    addRole(person, company, previous, "executive", started, { ended, email: true });
  }

  // Two Apollo-guessed emails on current roles.
  roles.filter((r) => r.status === "current" && r.businessEmail).slice(3, 3 + plan.guessedEmails).forEach((r) => (r.emailStatus = "guessed"));

  // --- Sponsor links ----------------------------------------------------------------------------
  const sponsorPeople = persons.filter((p) => personKind.get(p.id) === "sponsor");
  const sponsorLinks = sponsors.length
    ? operating
        .filter((c) => c.kind === "pe_backed")
        .map((c, i) => {
          const sponsor = sponsors[i % sponsors.length]!;
          const dealPartner = sponsorPeople.find((p) => primaryRole.get(p.id)?.companyId === sponsor.id);
          return {
            id: rng.uuid(),
            workspaceId,
            sponsorCompanyId: sponsor.id,
            portfolioCompanyId: c.id,
            dealType: rng.pick(["buyout", "growth", "recapitalization"]),
            acquiredOn: isoDate(addDays(now, -rng.int(365, 6 * 365))),
            dealPartnerPersonId: dealPartner?.id ?? null,
          };
        })
    : [];

  // --- Placements -----------------------------------------------------------------------------
  const placeable = execs.filter((p) => {
    const company = companies.find((c) => c.id === primaryRole.get(p.id)!.companyId)!;
    return company.kind === "pe_backed" || company.kind === "public";
  });
  const placements = placeable.slice(0, plan.placements).map((person, i) => {
    const role = primaryRole.get(person.id)!;
    if (i === 0) {
      // The first placement is recent, so the function-level off-limits rule below is active.
      role.effectiveOn = isoDate(addDays(now, -200));
      role.announcedOn = isoDate(addDays(now, -230));
    }
    return {
      id: rng.uuid(),
      workspaceId,
      personId: person.id,
      companyId: role.companyId,
      roleTitle: role.title,
      placedOn: role.effectiveOn!,
      searchReference: `${plan.slug === DEMO_PLAN.slug ? "DSP" : "HSG"}-${role.effectiveOn!.slice(0, 4)}-${String(i + 11).padStart(3, "0")}`,
    };
  });

  // --- Off-limits -----------------------------------------------------------------------------
  const offLimits: WorkspaceBundle["offLimits"] = [];
  if (plan.offLimits) {
    const client = companies.find((c) => c.kind === "client")!;
    offLimits.push({ id: rng.uuid(), workspaceId, companyId: client.id, scope: "company", reason: "current_client", startsOn: isoDate(addDays(now, -400)), setBy: partnerId });
    const recent = placements[0]!;
    offLimits.push({
      id: rng.uuid(),
      workspaceId,
      companyId: recent.companyId,
      scope: "function",
      function: "Finance",
      reason: "recent_placement",
      startsOn: recent.placedOn,
      endsOn: isoDate(addDays(new Date(recent.placedOn), 730)),
      setBy: partnerId,
    });
  }

  // --- Content --------------------------------------------------------------------------------
  const contentItems = CONTENT_ITEMS.slice(0, plan.contentItems).map((item, i) => ({
    id: rng.uuid(),
    workspaceId,
    title: item.title,
    url: `https://${plan.allowedDomains[0]}/insights/${item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`,
    topics: [...item.topics],
    publishedOn: isoDate(addDays(now, -(20 + i * 35))),
  }));

  // --- Feeds ----------------------------------------------------------------------------------
  const feeds: WorkspaceBundle["feeds"] = [
    { id: rng.uuid(), workspaceId, sourceType: "sec_8k", name: "SEC EDGAR 8-K Item 5.02", config: {} },
    { id: rng.uuid(), workspaceId, sourceType: "press_wire", name: "Appointments wire (demo)", config: { urls: ["https://wire.example.net/rss/appointments"], keywords: [], terms_url: "https://wire.example.net/terms" } },
    { id: rng.uuid(), workspaceId, sourceType: "google_alert", name: "Google Alerts: tracked executives", config: { urls: ["https://alerts.example.net/feeds/demo-executives"] } },
    { id: rng.uuid(), workspaceId, sourceType: "leadership_page", name: "Leadership and board pages", config: {} },
    { id: rng.uuid(), workspaceId, sourceType: "newsletter", name: "Newsletter events (CSV)", config: { format: "csv" } },
    { id: rng.uuid(), workspaceId, sourceType: "apollo", name: "Apollo enrichment", config: {} },
  ];

  // --- Interactions ---------------------------------------------------------------------------
  type Touch = "meeting" | "call" | "email_pair" | "email_out" | "linkedin" | "newsletter" | "event";
  const profileTouches: Record<string, () => { touches: Touch[]; lastDays: [number, number]; spreadDays: [number, number] }> = {
    strong: () => ({ touches: ["meeting", "meeting", "meeting", "call", "call", "email_pair", "email_pair", "email_pair", "email_pair", "linkedin"], lastDays: [3, 15], spreadDays: [15, 360] }),
    warm: () => ({ touches: ["meeting", "meeting", "call", "email_pair", "email_pair", "email_out", "newsletter"], lastDays: [20, 45], spreadDays: [45, 360] }),
    cooling: () => ({ touches: ["meeting", "email_pair", "email_out", ...(rng.chance(0.5) ? (["newsletter"] as Touch[]) : [])], lastDays: [100, 160], spreadDays: [160, 360] }),
    quiet: () => ({ touches: ["meeting", "meeting", "email_pair", "email_pair"], lastDays: [100, 115], spreadDays: [115, 300] }),
    cold: () => ({ touches: ["email_out", "linkedin", ...(rng.chance(0.5) ? (["email_pair"] as Touch[]) : [])], lastDays: [200, 340], spreadDays: [200, 360] }),
  };

  const withEmail = persons.filter((p) => roles.some((r) => r.personId === p.id && r.status === "current" && r.businessEmail));
  const ordered = [
    ...rng.shuffle(withEmail.filter((p) => p.isPriority)),
    ...rng.shuffle(withEmail.filter((p) => !p.isPriority)),
  ];
  const bands: [keyof typeof plan.profiles, number][] = [
    ["strong", plan.profiles.strong],
    ["quiet", plan.profiles.quiet],
    ["warm", plan.profiles.warm],
    ["cooling", plan.profiles.cooling],
    ["cold", plan.profiles.cold],
  ];
  const personProfile = new Map<string, string>();
  let cursor = 0;
  for (const [profile, count] of bands) for (let i = 0; i < count && cursor < ordered.length; i++) personProfile.set(ordered[cursor++]!.id, profile);

  const interactions: WorkspaceBundle["interactions"] = [];
  let externalCounter = 0;
  const at = (daysAgo: number) => new Date(addDays(now, -daysAgo).setUTCHours(13 + rng.int(0, 7), rng.int(0, 59), 0, 0));
  const topics = DEFAULT_TOPICS;

  function pushInteraction(person: (typeof persons)[number], touch: Touch, daysAgo: number, isPrivate: boolean) {
    const role = primaryRole.get(person.id);
    const base = {
      workspaceId,
      personId: person.id,
      roleId: role?.id ?? null,
      ourUserId: touch === "email_out" && rng.chance(0.2) ? outreachId : partnerId,
      isPrivate,
    };
    const ext = () => `seed-${plan.slug}-${++externalCounter}`;
    const subject = rng.pick(SUBJECTS);
    switch (touch) {
      case "meeting":
        interactions.push({ ...base, id: rng.uuid(), channel: "meeting", direction: "two_way", occurredAt: at(daysAgo), subject, provider: "microsoft", externalId: ext(), capturedBy: "auto" });
        break;
      case "call":
        interactions.push({ ...base, id: rng.uuid(), channel: "call", direction: "two_way", occurredAt: at(daysAgo), summary: "Call logged by the partner.", provider: "manual", externalId: ext(), capturedBy: "manual" });
        break;
      case "event":
        interactions.push({ ...base, id: rng.uuid(), channel: "event", direction: "two_way", occurredAt: at(daysAgo), subject: "Leadership dinner", provider: "manual", externalId: ext(), capturedBy: "manual" });
        break;
      case "linkedin":
        interactions.push({ ...base, id: rng.uuid(), channel: "linkedin_message", direction: "outbound", occurredAt: at(daysAgo), provider: "manual", externalId: ext(), capturedBy: "manual" });
        break;
      case "newsletter":
        interactions.push({ ...base, id: rng.uuid(), ourUserId: null, channel: "newsletter_click", direction: "not_applicable", occurredAt: at(daysAgo), provider: "newsletter", externalId: ext(), capturedBy: "import", contentTopic: rng.pick(topics) });
        break;
      case "email_out":
        interactions.push({ ...base, id: rng.uuid(), channel: "email", direction: "outbound", occurredAt: at(daysAgo), subject, provider: "microsoft", externalId: ext(), threadKey: `thread-${externalCounter}`, capturedBy: "auto" });
        break;
      case "email_pair": {
        const thread = `thread-${plan.slug}-${externalCounter + 1}`;
        interactions.push({ ...base, id: rng.uuid(), channel: "email", direction: "outbound", occurredAt: at(daysAgo + 1), subject, provider: "microsoft", externalId: ext(), threadKey: thread, capturedBy: "auto" });
        interactions.push({ ...base, id: rng.uuid(), ourUserId: partnerId, channel: "email", direction: "inbound", occurredAt: at(daysAgo), subject: `Re: ${subject}`, provider: "microsoft", externalId: ext(), threadKey: thread, capturedBy: "auto" });
        break;
      }
    }
  }

  let privateLeft = 2;
  for (const person of ordered) {
    const profile = personProfile.get(person.id);
    if (!profile) continue;
    const { touches, lastDays, spreadDays } = profileTouches[profile]!();
    const [first, ...rest] = rng.shuffle(touches);
    pushInteraction(person, first!, rng.int(lastDays[0], lastDays[1]), false);
    for (const touch of rest) {
      const isPrivate = profile === "strong" && touch === "email_pair" && privateLeft > 0;
      if (isPrivate) privateLeft--;
      pushInteraction(person, touch, rng.int(spreadDays[0], spreadDays[1]), isPrivate);
    }
  }

  // Hit the exact total: trim one-way and newsletter touches from cold and cooling people (never a
  // person's last touch), or top up strong and warm people with newsletter clicks, which weigh little.
  const target = plan.interactionTotal;
  if (target !== undefined) {
    const perPerson = new Map<string, number>();
    for (const i of interactions) perPerson.set(i.personId, (perPerson.get(i.personId) ?? 0) + 1);
    const trimmable = (i: (typeof interactions)[number]) =>
      (i.channel === "newsletter_click" || (i.direction === "outbound" && !i.threadKey?.startsWith(`thread-${plan.slug}`))) &&
      ["cold", "cooling"].includes(personProfile.get(i.personId) ?? "") &&
      (perPerson.get(i.personId) ?? 0) > 1;
    for (let k = interactions.length - 1; k >= 0 && interactions.length > target; k--) {
      const i = interactions[k]!;
      if (!trimmable(i)) continue;
      interactions.splice(k, 1);
      perPerson.set(i.personId, perPerson.get(i.personId)! - 1);
    }
    const topUp = ordered.filter((p) => ["strong", "warm"].includes(personProfile.get(p.id) ?? ""));
    for (let n = 0; interactions.length < target && topUp.length > 0; n++) pushInteraction(topUp[n % topUp.length]!, "newsletter", rng.int(10, 330), false);
    if (interactions.length !== target) throw new Error(`Seed produced ${interactions.length} interactions, expected ${target}.`);
  }
  interactions.sort((a, b) => (a.occurredAt as Date).getTime() - (b.occurredAt as Date).getTime());

  // --- Calendar events tomorrow ---------------------------------------------------------------
  const tomorrow = addDays(now, 1);
  const attendees = ordered.filter((p) => ["strong", "warm"].includes(personProfile.get(p.id) ?? "")).slice(0, plan.calendarEvents);
  const calendarEvents = attendees.map((person, i) => {
    const start = new Date(tomorrow);
    start.setUTCHours(14 + i * 2, i === 2 ? 30 : 0, 0, 0);
    const email = roles.find((r) => r.personId === person.id && r.status === "current" && r.businessEmail)!.businessEmail!;
    return {
      id: rng.uuid(),
      workspaceId,
      userId: partnerId,
      provider: "microsoft",
      externalId: `seed-cal-${plan.slug}-${i + 1}`,
      startsAt: start,
      endsAt: new Date(start.getTime() + 45 * 60_000),
      title: i === 0 ? `Breakfast with ${person.fullName.split(" ")[0]}` : `Meeting: ${person.fullName}`,
      attendeeEmails: [userEmails[partnerKey]!, email],
      personIds: [person.id],
    };
  });

  // --- Consent --------------------------------------------------------------------------------
  const consents: WorkspaceBundle["consents"] = [];
  let legitimateInterestGiven = false;
  for (const person of persons) {
    if (person.country === "DE" || person.country === "GB") {
      const status = person.country === "GB" || !legitimateInterestGiven ? "legitimate_interest" : "unknown";
      if (person.country === "DE" && status === "legitimate_interest") legitimateInterestGiven = true;
      consents.push({
        id: rng.uuid(), workspaceId, personId: person.id, channel: "email", purpose: "outreach", status,
        jurisdiction: person.country, capturedVia: "seed",
        proof: status === "legitimate_interest" ? "Existing business relationship, recorded by the data steward." : null,
        recordedBy: status === "legitimate_interest" ? stewardId : null,
      });
    }
  }
  withEmail.slice(0, Math.min(30, withEmail.length)).forEach((person) => {
    if (person.country !== "US") return;
    consents.push({ id: rng.uuid(), workspaceId, personId: person.id, channel: "newsletter", purpose: "newsletter", status: "opted_in", jurisdiction: "US", capturedVia: "newsletter signup", proof: "Double opt-in confirmation." });
  });

  // --- Provenance -----------------------------------------------------------------------------
  const fieldSources: WorkspaceBundle["fieldSources"] = [];
  for (const role of roles) {
    const source = rng.chance(0.7) ? "apollo" : "manual";
    fieldSources.push({ id: rng.uuid(), workspaceId, entityType: "role", entityId: role.id, field: "title", value: role.title, sourceType: source, confidence: "medium", capturedAt: addDays(now, -rng.int(5, 200)) });
    if (role.businessEmail) {
      fieldSources.push({ id: rng.uuid(), workspaceId, entityType: "role", entityId: role.id, field: "business_email", value: role.businessEmail, sourceType: "apollo", confidence: role.emailStatus === "verified" ? "high" : "low", capturedAt: addDays(now, -rng.int(5, 200)) });
    }
  }
  for (const person of persons) {
    if (person.linkedinUrl) fieldSources.push({ id: rng.uuid(), workspaceId, entityType: "person", entityId: person.id, field: "linkedin_url", value: person.linkedinUrl, sourceType: "manual", confidence: "high", capturedAt: addDays(now, -rng.int(30, 400)) });
  }

  // --- Interests ------------------------------------------------------------------------------
  const personInterests: WorkspaceBundle["personInterests"] = [];
  for (const person of ordered) {
    if (!["strong", "warm"].includes(personProfile.get(person.id) ?? "")) continue;
    for (const topic of rng.shuffle(topics).slice(0, rng.int(1, 2))) {
      personInterests.push({ id: rng.uuid(), workspaceId, personId: person.id, topic, source: rng.chance(0.5) ? "first_party" : "manual", capturedAt: addDays(now, -rng.int(5, 90)) });
    }
  }

  return {
    workspace,
    members,
    companies: companies.map(({ kind, ...company }) => company),
    persons,
    roles,
    sponsorLinks,
    placements,
    offLimits,
    contentItems,
    feeds,
    interactions,
    calendarEvents,
    consents,
    fieldSources,
    personInterests,
  };
}
