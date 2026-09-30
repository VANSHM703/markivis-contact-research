/** Normalisation used for matching (BRD 6.1 and 7.2). Pure functions. */

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "prof", "professor", "sir", "dame", "lord", "lady", "hon"]);
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "phd", "md", "mba", "cpa", "cfa", "esq", "obe", "cbe", "kbe"]);
const COMPANY_SUFFIXES = new Set(["inc", "incorporated", "llc", "ltd", "limited", "plc", "corp", "corporation", "co", "company", "lp", "llp"]);

function stripAccents(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

function tokens(value: string): string[] {
  return stripAccents(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/['-]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

/** Lowercase, accents stripped, honorifics and suffixes removed. "Dr. José Núñez Jr." becomes "jose nunez". */
export function normaliseName(name: string): string {
  const parts = tokens(name);
  while (parts.length > 1 && HONORIFICS.has(parts[0]!)) parts.shift();
  while (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1]!)) parts.pop();
  return parts.join(" ");
}

/** Legal suffixes (Inc, LLC, Ltd, plc, Corp, Co) removed. "Example Holdings, Inc." becomes "example holdings". */
export function normaliseCompanyName(name: string): string {
  const parts = tokens(name);
  while (parts.length > 1 && COMPANY_SUFFIXES.has(parts[parts.length - 1]!)) parts.pop();
  if (parts[0] === "the" && parts.length > 1) parts.shift();
  return parts.join(" ");
}

/** Canonical form https://www.linkedin.com/in/<slug>, or null when the input is not a profile URL. */
export function canonicalLinkedinUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return null;
  const match = parsed.pathname.match(/^\/in\/([^/?#]+)/i);
  if (!match?.[1]) return null;
  return `https://www.linkedin.com/in/${decodeURIComponent(match[1]).toLowerCase()}`;
}

/** Lowercase registrable domain from a URL, email or bare domain. "https://www.Example.com/about" becomes "example.com". */
export function normaliseDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  let host = value.trim().toLowerCase();
  if (host.includes("@")) host = host.split("@").pop() ?? "";
  host = host.replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0] ?? "";
  host = host.replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

export function normaliseEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const value = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

/** SEC CIK zero-padded to 10 digits. */
export function normaliseCik(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const digits = String(value).replace(/\D/g, "");
  return digits.length > 0 && digits.length <= 10 ? digits.padStart(10, "0") : null;
}
