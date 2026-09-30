/** Interface labels for stored values. Sentence case, US English (design file 12). */

export const CONTACT_TYPE_LABELS: Record<string, string> = {
  prospective_client: "Prospective client",
  potential_candidate: "Potential candidate",
  referrer: "Referrer",
  sponsor_contact: "Sponsor contact",
};

export const OWNERSHIP_LABELS: Record<string, string> = {
  public: "Public",
  pe_backed: "PE-backed",
  vc_backed: "VC-backed",
  private: "Private",
  non_profit: "Non-profit",
  unknown: "Unknown",
};

export const CLIENT_STATUS_LABELS: Record<string, string> = { client: "Client", prospect: "Prospect", none: "None" };

export const SEAT_TYPE_LABELS: Record<string, string> = {
  executive: "Executive",
  board: "Board",
  advisory: "Advisory",
  pe_operating_partner: "Operating partner",
  pe_deal_partner: "Deal partner",
  other: "Other",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Sep 29, 2026" (design file 12). Accepts a Date or a YYYY-MM-DD string. */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : value;
  return dateFormatter.format(date);
}

export function pageParam(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
