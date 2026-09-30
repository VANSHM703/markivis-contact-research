/**
 * The job schedule (BRD 8.9). Times are workspace time unless the entry pins a time zone.
 * Jobs whose milestone has not been built yet are listed for completeness and not scheduled.
 */
import type { SourceType } from "@/ingest/types";

export interface ScheduleEntry {
  /** Distinguishes several crons for one job, for example SEC business hours and otherwise. */
  slot: string;
  cron: string;
  /** Fixed time zone; omit to use the workspace's own. */
  tz?: string;
  /** Derives the cron from workspace settings instead, for example the digest time. */
  cronFromSettings?: (settings: Record<string, unknown>) => string;
}

/** "08:00" in settings.digest_time to "0 8 * * *"; anything malformed falls back to 08:00. */
export function digestCron(settings: Record<string, unknown>): string {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(settings.digest_time ?? ""));
  return match ? `${Number(match[2])} ${Number(match[1])} * * *` : "0 8 * * *";
}

export interface JobDefinition {
  name: string;
  schedules: ScheduleEntry[];
  /** For ingest jobs: the source they run. */
  source?: SourceType;
  /** Milestone that implements it; only built jobs are scheduled and worked. */
  builtIn: "M3" | "M4" | "M5" | "M7" | "M8" | "M9" | "M10";
  /** Per-workspace (data carries workspaceId) or once for the whole deployment. */
  scope: "workspace" | "platform";
  notes?: string;
}

const EASTERN = "America/New_York";

export const JOBS: JobDefinition[] = [
  {
    name: "ingest.sec",
    source: "sec_8k",
    builtIn: "M3",
    scope: "workspace",
    // Every 30 minutes, 06:00 to 22:00 US Eastern on business days; every 2 hours otherwise.
    schedules: [
      { slot: "business", cron: "*/30 6-21 * * 1-5", tz: EASTERN },
      { slot: "weeknight", cron: "0 0,2,4,22 * * 1-5", tz: EASTERN },
      { slot: "weekend", cron: "0 */2 * * 0,6", tz: EASTERN },
    ],
  },
  { name: "ingest.wires", source: "press_wire", builtIn: "M3", scope: "workspace", schedules: [{ slot: "every30", cron: "*/30 * * * *" }] },
  { name: "ingest.alerts", source: "google_alert", builtIn: "M3", scope: "workspace", schedules: [{ slot: "hourly", cron: "0 * * * *" }] },
  { name: "ingest.pages", source: "leadership_page", builtIn: "M3", scope: "workspace", schedules: [{ slot: "weekly", cron: "0 3 * * 1" }], notes: "Jittered per company." },
  { name: "ingest.apollo", source: "apollo", builtIn: "M3", scope: "workspace", schedules: [{ slot: "weekly", cron: "0 2 * * 0" }], notes: "Also on demand when a person or company is added. Credit guard." },
  { name: "ingest.newsletter", source: "newsletter", builtIn: "M3", scope: "workspace", schedules: [{ slot: "daily", cron: "0 4 * * *" }], notes: "Also immediately on CSV upload." },
  { name: "records.status", builtIn: "M3", scope: "workspace", schedules: [{ slot: "daily", cron: "30 0 * * *" }], notes: "People whose last role ended 90 days ago become no_current_role (BRD 7.3)." },
  { name: "scheduler.sync", builtIn: "M3", scope: "platform", schedules: [{ slot: "every10", cron: "*/10 * * * *", tz: "UTC" }], notes: "Reconciles per-workspace schedules with the workspace list." },
  { name: "pipeline.process", builtIn: "M4", scope: "workspace", schedules: [{ slot: "every5", cron: "*/5 * * * *" }], notes: "Triggered by every ingest that adds items; the 5-minute schedule is a backstop. Batches of 25." },
  { name: "pipeline.research", builtIn: "M4", scope: "workspace", schedules: [], notes: "On demand, when a validator sends an item for more research." },
  { name: "validation.spot_check", builtIn: "M4", scope: "workspace", schedules: [{ slot: "weekly", cron: "0 5 * * 1" }] },
  { name: "stats.sources", builtIn: "M4", scope: "workspace", schedules: [{ slot: "weekly", cron: "30 5 * * 1" }] },
  { name: "actions.sla", builtIn: "M5", scope: "workspace", schedules: [{ slot: "hourly", cron: "0 * * * *" }], notes: "Escalates actions overdue by one working day (BRD 12.8)." },
  { name: "digest.daily", builtIn: "M5", scope: "workspace", schedules: [{ slot: "daily", cron: "0 8 * * *", cronFromSettings: digestCron }], notes: "At the workspace digest_time." },
  { name: "notifications.send", builtIn: "M5", scope: "workspace", schedules: [{ slot: "every1", cron: "* * * * *" }], notes: "Delivers queued alerts; also sent right after the event that queues them." },
  { name: "capture.mail", builtIn: "M7", scope: "workspace", schedules: [{ slot: "every15", cron: "*/15 * * * *" }], notes: "Delta sync for every active mailbox connection in the workspace." },
  { name: "capture.calendar", builtIn: "M7", scope: "workspace", schedules: [{ slot: "every15", cron: "*/15 * * * *" }], notes: "The last 30 days and the next 14 days." },
  { name: "rel.score", builtIn: "M8", scope: "workspace", schedules: [{ slot: "nightly", cron: "0 1 * * *" }], notes: "Firm-level and per-user scores (BRD 11.4)." },
  { name: "rel.connections", builtIn: "M8", scope: "workspace", schedules: [{ slot: "nightly", cron: "30 1 * * *" }], notes: "Connections derived from roles (BRD 11.6)." },
  { name: "rel.quiet", builtIn: "M8", scope: "workspace", schedules: [{ slot: "daily", cron: "0 6 * * *" }], notes: "Going-quiet alerts and re-engage actions (BRD 11.5)." },
  { name: "briefs.generate", builtIn: "M9", scope: "workspace", schedules: [{ slot: "hourly", cron: "15 * * * *" }] },
  { name: "crm.sync", builtIn: "M9", scope: "workspace", schedules: [{ slot: "every15", cron: "*/15 * * * *" }] },
  { name: "compliance.retention", builtIn: "M10", scope: "workspace", schedules: [{ slot: "monthly", cron: "0 9 1-7 * 1" }], notes: "First Monday of the month." },
];

const BUILT = new Set(["M3", "M4", "M5", "M7", "M8"]);
export const ACTIVE_JOBS = JOBS.filter((j) => BUILT.has(j.builtIn));

/** pg-boss schedule keys allow letters, digits, _ - . / only. */
export const scheduleKey = (workspaceId: string, slot: string) => `${workspaceId}.${slot}`;

export interface IngestJobData {
  workspaceId: string;
  feedId?: string;
  /** Apollo on-demand enrichment (essential under the credit guard). */
  personIds?: string[];
  companyIds?: string[];
  /** pipeline.research: the signal to research. */
  signalId?: string;
  /** capture.*: one connection only (Sync now). */
  connectionId?: string;
}
