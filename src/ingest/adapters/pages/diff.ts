/** Leadership page snapshots and diffs (BRD 8.5). Pure. */
import { createHash } from "node:crypto";

export const hashText = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

const LEADERSHIP_TERM = /\b(chief|officer|president|chair|director|board|vice president|svp|evp|vp|head of|general counsel|secretary|treasurer|founder|partner|ceo|cfo|coo|cto|cio|chro|cmo)\b/i;
/** Two to four capitalised words, allowing initials, hyphens and apostrophes: a likely person name. */
const PERSON_NAME = /^(?:[A-Z][a-zA-Z'’-]+|[A-Z]\.)(?:\s+(?:[A-Z][a-zA-Z'’-]+|[A-Z]\.)){1,3}$/;

export function isSignificantLine(line: string): boolean {
  const text = line.trim();
  if (text.length < 3 || text.length > 200) return false;
  return LEADERSHIP_TERM.test(text) || PERSON_NAME.test(text);
}

export interface PageDiff {
  added: string[];
  removed: string[];
}

/** Lines added and removed, compared as sets; only lines that look like names or titles count. */
export function diffLines(before: string[], after: string[]): PageDiff {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: after.filter((l) => !b.has(l) && isSignificantLine(l)),
    removed: before.filter((l) => !a.has(l) && isSignificantLine(l)),
  };
}
