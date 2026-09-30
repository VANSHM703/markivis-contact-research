/**
 * Title normalisation (BRD 6.1): maps a published title to the controlled list, a function and a
 * seniority. Rules run in order; the first match wins. Pure.
 */

export const NORMALISED_TITLES = [
  "CEO", "CFO", "COO", "CTO", "CIO", "CHRO", "CMO", "CRO", "GC", "President", "Chair", "Director", "VP", "SVP", "Other",
] as const;
export type NormalisedTitle = (typeof NORMALISED_TITLES)[number];

export const FUNCTIONS = [
  "Finance", "Technology", "People", "Operations", "Sales", "Marketing", "Legal", "General management", "Board",
] as const;
export type RoleFunction = (typeof FUNCTIONS)[number];

export type Seniority = "c_suite" | "board" | "svp" | "vp" | "other";
export type SeatType = "executive" | "board" | "advisory" | "pe_operating_partner" | "pe_deal_partner" | "other";

export interface TitleInfo {
  titleNormalised: NormalisedTitle;
  function: RoleFunction | null;
  seniority: Seniority;
  /** The seat type the title implies when the source does not say. */
  seatType: SeatType;
}

interface Rule {
  test: RegExp;
  info: TitleInfo;
}

const exec = (titleNormalised: NormalisedTitle, fn: RoleFunction | null, seniority: Seniority = "c_suite"): TitleInfo => ({
  titleNormalised,
  function: fn,
  seniority,
  seatType: "executive",
});

// Order matters: specific chiefs before generic words, vice presidents before "president",
// board titles before "director".
const RULES: Rule[] = [
  { test: /\b(chair(man|woman|person)?|chair of the board)\b/, info: { titleNormalised: "Chair", function: "Board", seniority: "board", seatType: "board" } },
  { test: /\b(independent|non[- ]executive|board)\s+director\b|\bdirector,? board\b|\bboard member\b|\btrustee\b/, info: { titleNormalised: "Director", function: "Board", seniority: "board", seatType: "board" } },
  { test: /\bchief executive\b|\bceo\b/, info: exec("CEO", "General management") },
  { test: /\bchief financial\b|\bcfo\b/, info: exec("CFO", "Finance") },
  { test: /\bchief operating\b|\bcoo\b/, info: exec("COO", "Operations") },
  { test: /\bchief technology\b|\bcto\b/, info: exec("CTO", "Technology") },
  { test: /\bchief (information|digital)\b|\bcio\b|\bcdo\b/, info: exec("CIO", "Technology") },
  { test: /\bchief (human resources|people|talent)\b|\bchro\b|\bcpo\b/, info: exec("CHRO", "People") },
  { test: /\bchief marketing\b|\bcmo\b/, info: exec("CMO", "Marketing") },
  { test: /\bchief (revenue|commercial|sales)\b|\bcro\b|\bcco\b/, info: exec("CRO", "Sales") },
  { test: /\bgeneral counsel\b|\bchief legal\b|\bclo\b/, info: exec("GC", "Legal") },
  { test: /\b(svp|senior vice president|evp|executive vice president)\b/, info: exec("SVP", null, "svp") },
  { test: /\b(vp|vice president)\b/, info: exec("VP", null, "vp") },
  { test: /\bpresident\b/, info: exec("President", "General management") },
  { test: /\bdirector\b/, info: { titleNormalised: "Director", function: null, seniority: "other", seatType: "executive" } },
];

const FUNCTION_WORDS: [RegExp, RoleFunction][] = [
  [/\b(finance|financial|treasury|accounting|controller)\b/, "Finance"],
  [/\b(technology|engineering|it|information|digital|data|software)\b/, "Technology"],
  [/\b(people|hr|human resources|talent)\b/, "People"],
  [/\b(operations|supply chain|manufacturing)\b/, "Operations"],
  [/\b(sales|revenue|commercial|business development)\b/, "Sales"],
  [/\b(marketing|brand|communications)\b/, "Marketing"],
  [/\b(legal|counsel|compliance)\b/, "Legal"],
];

export function normaliseTitle(title: string): TitleInfo {
  const value = title.toLowerCase().replace(/[.&]/g, " ").replace(/\s+/g, " ").trim();
  const rule = RULES.find((r) => r.test.test(value));
  const info: TitleInfo = rule ? { ...rule.info } : { titleNormalised: "Other", function: null, seniority: "other", seatType: "executive" };
  if (!info.function) info.function = FUNCTION_WORDS.find(([re]) => re.test(value))?.[1] ?? null;
  // "Director, Board" style titles never carry a functional department.
  if (info.seatType === "board") info.function = "Board";
  return info;
}

/** Ranking for the primary role rule (BRD 7.3): higher is more senior. */
export const SENIORITY_RANK: Record<Seniority, number> = { c_suite: 4, svp: 3, vp: 2, other: 1, board: 0 };
