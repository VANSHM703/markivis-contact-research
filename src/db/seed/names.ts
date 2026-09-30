/**
 * Fictional names for seed data. Company names are coined words; every domain is a subdomain
 * of a reserved example domain (example.com, example.org). No real person or company is intended.
 */

export const FIRST_NAMES = [
  "Adaeze", "Alden", "Amara", "Anders", "Anneliese", "Arjun", "Beatriz", "Bram", "Callum", "Camille",
  "Cassius", "Dalia", "Declan", "Delphine", "Emeka", "Esme", "Farrah", "Felix", "Freya", "Gideon",
  "Hana", "Hollis", "Imogen", "Ines", "Jasper", "Kaia", "Kenji", "Leona", "Linnea", "Lucian",
  "Mairead", "Malik", "Marisol", "Nadia", "Niall", "Odile", "Oren", "Petra", "Quentin", "Rafferty",
  "Renata", "Rosalind", "Rowan", "Saoirse", "Silas", "Solveig", "Tamsin", "Teodor", "Thea", "Ulrich",
  "Vesna", "Wendell", "Wren", "Xavier", "Yara", "Yusuf", "Zadie", "Zoltan", "Ingrid", "Hugo",
] as const;

export const LAST_NAMES = [
  "Abernathy", "Ashcombe", "Balfour", "Bellweather", "Birchall", "Blackwood", "Calloway", "Carrow", "Castellane", "Dunmore",
  "Ellery", "Fairbrother", "Farrington", "Fenwick", "Galloway", "Greaves", "Hartigan", "Holloway", "Iverson", "Jessop",
  "Kavanagh", "Kendrick", "Lacroix", "Lindqvist", "Lockhart", "Marchetti", "Merriweather", "Montague", "Nakamura", "Northcott",
  "Okonkwo", "Oyelaran", "Pemberton", "Penrose", "Quintero", "Radcliffe", "Ravensworth", "Rourke", "Salazar", "Sandoval",
  "Sinclair", "Somerset", "Stanhope", "Takahashi", "Thorne", "Trevelyan", "Underhill", "Vasquez", "Vaughn", "Wainwright",
  "Whitcombe", "Winslow", "Yardwell", "Ziegler", "Adeyemi", "Beaumont", "Castellanos", "Delacroix", "Esposito", "Fitzhale",
] as const;

export interface CompanySeed {
  name: string;
  industry: string;
  kind: "public" | "pe_backed" | "private" | "sponsor" | "client";
  ticker?: string;
  hqCountry?: string;
  hqRegion?: string;
}

export const DEMO_COMPANIES: readonly CompanySeed[] = [
  // 15 public
  { name: "Quarnell Systems, Inc.", industry: "Software", kind: "public", ticker: "QRNL" },
  { name: "Brevik Harlow Foods", industry: "Consumer goods", kind: "public", ticker: "BHFD" },
  { name: "Tessaline Energy Corp.", industry: "Energy", kind: "public", ticker: "TSLE" },
  { name: "Morvane Industrial", industry: "Industrials", kind: "public", ticker: "MRVN" },
  { name: "Caldrith Health", industry: "Healthcare", kind: "public", ticker: "CLDH" },
  { name: "Ulvera Materials", industry: "Materials", kind: "public", ticker: "ULVM" },
  { name: "Penhallow Financial plc", industry: "Financial services", kind: "public", ticker: "PNHF", hqCountry: "GB", hqRegion: "England" },
  { name: "Draymoor Logistics", industry: "Transportation", kind: "public", ticker: "DRYL" },
  { name: "Ostrana Software", industry: "Software", kind: "public", ticker: "OSTR" },
  { name: "Kelvaro Networks", industry: "Telecommunications", kind: "public", ticker: "KLVN" },
  { name: "Varnhold Chemicals", industry: "Chemicals", kind: "public", ticker: "VRNC" },
  { name: "Silvaran Retail Group", industry: "Retail", kind: "public", ticker: "SLVR" },
  { name: "Tamsworth Aerospace", industry: "Aerospace", kind: "public", ticker: "TMSA" },
  { name: "Heddrick Water", industry: "Utilities", kind: "public", ticker: "HDWR" },
  { name: "Norvessa Medical", industry: "Medical devices", kind: "public", ticker: "NVSM" },
  // 12 PE-backed
  { name: "Ashvale Dental Partners", industry: "Healthcare services", kind: "pe_backed" },
  { name: "Brisk Harbor Pet Care", industry: "Consumer services", kind: "pe_backed" },
  { name: "Corrimont Labs", industry: "Life sciences", kind: "pe_backed" },
  { name: "Dellavar Building Products", industry: "Building products", kind: "pe_backed" },
  { name: "Ettrick Lane Insurance Services", industry: "Insurance", kind: "pe_backed" },
  { name: "Faircliff Education", industry: "Education", kind: "pe_backed" },
  { name: "Glenmara Packaging GmbH", industry: "Packaging", kind: "pe_backed", hqCountry: "DE", hqRegion: "Bavaria" },
  { name: "Hollisk Security", industry: "Security services", kind: "pe_backed" },
  { name: "Innesmoor Home Services", industry: "Home services", kind: "pe_backed" },
  { name: "Jorvale Specialty Chemicals", industry: "Chemicals", kind: "pe_backed" },
  { name: "Kestrine Fleet Services", industry: "Transportation", kind: "pe_backed" },
  { name: "Loramere Clinics", industry: "Healthcare services", kind: "pe_backed" },
  // 8 private
  { name: "Maddox Verne Apparel", industry: "Apparel", kind: "private" },
  { name: "Nethercote Farms", industry: "Agriculture", kind: "private" },
  { name: "Orlanda Hotels", industry: "Hospitality", kind: "private" },
  { name: "Pellingham Engineering", industry: "Engineering", kind: "private" },
  { name: "Quenby Robotics", industry: "Robotics", kind: "private" },
  { name: "Rostrevor Media", industry: "Media", kind: "private" },
  { name: "Sallowmere Wines", industry: "Beverages", kind: "private" },
  { name: "Thistlegate Construction", industry: "Construction", kind: "private" },
  // 3 PE sponsors
  { name: "Aldermoor Capital Partners", industry: "Private equity", kind: "sponsor" },
  { name: "Blackwren Equity", industry: "Private equity", kind: "sponsor" },
  { name: "Cindervale Partners", industry: "Private equity", kind: "sponsor" },
  // 2 clients
  { name: "Wexcombe Group", industry: "Industrials", kind: "client" },
  { name: "Yarrowdene Holdings", industry: "Financial services", kind: "client" },
];

export const HARBOR_COMPANIES: readonly CompanySeed[] = [
  { name: "Pellucid Grain Co.", industry: "Agriculture", kind: "private" },
  { name: "Ravelstone Freight", industry: "Transportation", kind: "pe_backed" },
  { name: "Sundial Orthopedics", industry: "Medical devices", kind: "public", ticker: "SDLO" },
  { name: "Tarnwick Cable", industry: "Telecommunications", kind: "public", ticker: "TRNW" },
  { name: "Umberlea Foods", industry: "Consumer goods", kind: "private" },
];

export const CONTENT_ITEMS = [
  { title: "What boards ask in the first 100 days of a CEO transition", topics: ["CEO succession", "Board composition"] },
  { title: "The CFO agenda after a sponsor exit", topics: ["CFO agenda", "PE portfolio leadership"] },
  { title: "Five questions for a new CHRO", topics: ["CHRO agenda", "Leadership transitions"] },
  { title: "Succession planning when the CEO has served a decade", topics: ["CEO succession"] },
  { title: "Building a technology leadership bench", topics: ["Technology leadership"] },
  { title: "Newsletter: board refresh season", topics: ["Board composition"] },
  { title: "Interview: leading a portfolio company through its second sponsor", topics: ["PE portfolio leadership", "Leadership transitions"] },
  { title: "How finance chiefs are reshaping the operating model", topics: ["CFO agenda"] },
] as const;
