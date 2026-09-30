/**
 * Working-day arithmetic for service levels (BRD 12.8, 10.3), in the workspace's time zone and
 * working days (settings.working_days, default Monday to Friday). Due times are end of day.
 */
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")) };
}

/** The UTC instant of a local wall-clock time on a calendar date in the time zone. */
export function localTime(y: number, m: number, d: number, hour: number, minute: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute, 0));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess.getTime() - (shown - guess.getTime()));
}

function localFivePm(y: number, m: number, d: number, timeZone: string): Date {
  return localTime(y, m, d, 17, 0, timeZone);
}

/** The local calendar date, YYYY-MM-DD, in the time zone. */
export function localDate(date: Date, timeZone = "America/New_York"): string {
  const { y, m, d } = localParts(date, timeZone);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The UTC instant of local midnight at the start of the date's day. */
export function startOfLocalDay(date: Date, timeZone = "America/New_York"): Date {
  const { y, m, d } = localParts(date, timeZone);
  return localTime(y, m, d, 0, 0, timeZone);
}

/** The UTC instant of 23:59 local on the date's day. */
export function endOfLocalDay(date: Date, timeZone = "America/New_York"): Date {
  const { y, m, d } = localParts(date, timeZone);
  return localTime(y, m, d, 23, 59, timeZone);
}

/** Working days between two dates, counting Monday to Friday only (BRD 10.3). */
export function workingDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let days = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days++;
  }
  return days;
}

/** Escalation (BRD 12.8): an action is escalated once it is overdue by one working day. */
export function escalatesAt(dueAt: Date, timeZone = "America/New_York", workingDays: readonly string[] = ["Mon", "Tue", "Wed", "Thu", "Fri"]): Date {
  return addWorkingDays(dueAt, 1, timeZone, workingDays);
}

export function isWorkingDay(y: number, m: number, d: number, workingDays: readonly string[]): boolean {
  return workingDays.includes(DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!);
}

/** The end of the working day `n` working days after `from` (n may be negative). */
export function addWorkingDays(from: Date, n: number, timeZone = "America/New_York", workingDays: readonly string[] = ["Mon", "Tue", "Wed", "Thu", "Fri"]): Date {
  let { y, m, d } = localParts(from, timeZone);
  let remaining = Math.abs(n);
  const step = n >= 0 ? 1 : -1;
  while (remaining > 0) {
    const next = new Date(Date.UTC(y, m - 1, d + step));
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
    if (isWorkingDay(y, m, d, workingDays)) remaining--;
  }
  return localFivePm(y, m, d, timeZone);
}

/** Monday of the ISO week containing the date, as YYYY-MM-DD, in the time zone. */
export function weekStart(date: Date, timeZone = "America/New_York"): string {
  const { y, m, d } = localParts(date, timeZone);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const back = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - back);
  return utc.toISOString().slice(0, 10);
}

/** ISO week label, for example 2026-W40. */
export function isoWeek(dateIso: string): string {
  const date = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
