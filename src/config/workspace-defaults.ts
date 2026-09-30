/** Workspace defaults: settings from BRD 20.3, feature flags from BRD 2, topics from BRD 14. */

export const DEFAULT_TOPICS = [
  "CEO succession",
  "Board composition",
  "Leadership transitions",
  "PE portfolio leadership",
  "CHRO agenda",
  "CFO agenda",
  "Technology leadership",
] as const;

export const DEFAULT_SETTINGS = {
  digest_time: "08:00",
  working_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  sla: { p1_working_days: 2, p2_working_days: 5, announced_lead_working_days: 2 },
  scoring: {
    weights: { recency: 0.3, frequency: 0.25, reciprocity: 0.2, depth: 0.15, tenure: 0.1 },
    recency_half_scale_days: 90,
    bands: { strong: 70, warm: 45, cooling: 25, cold: 1 },
  },
  quiet_days: 90,
  ceo_tenure_years: 7,
  connections: { max_company_size: 2000, board_overlap_months: 6, exec_overlap_months: 12 },
  validation: { spot_check_share: 0.1, spot_check_min: 5, suspend_error_rate: 0.02, feed_reject_flag_rate: 0.5 },
  send: { via: "mailbox", max_per_day: 25 },
  apollo: { monthly_credit_cap: null },
  ai: { monthly_budget_usd: 250 },
  validator_hours_per_week: 5,
  reputable_outlets: [] as string[],
  style_guide:
    "Write as the partner, in the first person, in formal but warm American business English. Email: 120 words maximum. LinkedIn: 60 words maximum. Open with the specific reason for writing. Refer only to facts provided. No flattery or filler (for example 'I hope this finds you well', 'thrilled', 'exciting'). No exclamation marks. End with one clear, low-pressure ask. Sign off with the partner's first name.",
  topics: [...DEFAULT_TOPICS],
};

/** Launch capabilities on, Release 3 capabilities off (BRD 2). */
export const DEFAULT_FLAGS: Record<string, boolean> = {
  "source.apollo": true,
  "source.sec": true,
  "source.wires": true,
  "source.alerts": true,
  "source.pages": true,
  "source.newsletter": true,
  "validation.batch_p3": true,
  "pack.exec_search": true,
  "capture.microsoft": true,
  "capture.google": false,
  "rel.scoring": true,
  "rel.quiet": true,
  "rel.connections": true,
  "rel.paths": true,
  "rel.briefs": true,
  "send.mailbox": true,
  "crm.hubspot": false,
  "rel.graph": false,
  "pack.pe_mapping": false,
  "source.licensed": false,
  "source.news": false,
  "source.warn": false,
  "source.jobs": false,
};

export const DEFAULT_PACKS: Record<string, boolean> = { exec_search: true, pe_mapping: false };
