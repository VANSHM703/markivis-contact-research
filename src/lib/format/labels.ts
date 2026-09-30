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
export const SOURCE_TYPE_LABELS: Record<string, string> = {
  sec_8k: "SEC filing",
  press_wire: "Press release",
  google_alert: "Google Alert",
  leadership_page: "Leadership page",
  apollo: "Apollo",
  newsletter: "Newsletter",
  manual: "Manual",
  ai_research: "AI research",
  event_site: "Event website",
  crm: "CRM",
};

/** Signal types in sentence case for the interface (BRD 9.3). */
export const SIGNAL_TYPE_LABELS: Record<string, string> = {
  person_move_announced: "Move announced",
  person_left: "Left a role",
  person_joined: "Joined",
  person_board_change: "Board change",
  company_cxo_change: "Leadership change",
  company_pe_transaction: "PE transaction",
  company_mna: "Merger or acquisition",
  company_funding_ipo: "Funding or IPO",
  person_promotion: "Promotion",
  person_speaking: "Speaking",
  person_email_bounced: "Email bounced",
  company_layoffs: "Layoffs",
  company_expansion: "Expansion",
  company_hiring_surge: "Hiring surge",
  internal_relationship_quiet: "Going quiet",
  person_award: "Award",
  person_content_engagement: "Content engagement",
  company_ceo_tenure_threshold: "Long CEO tenure",
  company_product_partnership: "Partnership",
  company_intent_spike: "Intent spike",
  other: "Other",
};

export const ACTION_TYPE_LABELS: Record<string, string> = {
  congratulate: "Congratulate",
  check_in: "Check in",
  introduction_request: "Ask for an introduction",
  invite_interview: "Invite to interview",
  invite_event: "Invite to an event",
  share_content: "Share content",
  pause: "Pause outreach",
  reengage: "Re-engage",
  custom: "Custom",
};

export const ACTION_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  drafted: "Drafted",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  sent: "Sent",
  done: "Done",
  dismissed: "Dismissed",
  expired: "Expired",
};

export const DISMISS_REASON_LABELS: Record<string, string> = {
  not_relevant: "Not relevant",
  already_known: "Already known",
  wrong_timing: "Wrong timing",
  off_limits: "Off-limits",
};

export const OUTCOME_LABELS: Record<string, string> = {
  none: "Not recorded",
  no_reply: "No reply",
  replied: "Replied",
  meeting: "Meeting",
  mandate: "Mandate",
};

export const BAND_LABELS: Record<string, string> = { strong: "Strong", warm: "Warm", cooling: "Cooling", cold: "Cold", none: "None" };

/** "Sep 29, 2026" for an instant, on the calendar of the given time zone. */
export function formatDateIn(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone }).format(value);
}

/** "2:30 PM" in the given time zone. */
export function formatTimeIn(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(value);
}
