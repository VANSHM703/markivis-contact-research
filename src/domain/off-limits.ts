/**
 * Off-limits rules (BRD 13, 6.5): per company, by scope (the whole company, one function, or a
 * seniority and above), with a reason and dates. Partner only. Enforcement is in checks.ts (BRD
 * 12.2 step 4); this module adds, ends and lists rules and says who they cover.
 */
import { and, asc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { companies, offLimits, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { assertCan, type Capability } from "@/lib/permissions";
import type { WorkspaceRole } from "@/config/navigation";

export const SCOPES = ["company", "function", "level_and_above"] as const;
export const REASONS = ["current_client", "recent_placement", "contractual"] as const;
export const SENIORITIES = ["c_suite", "svp", "vp"] as const;
export const EXPIRY_REMINDER_DAYS = 30;

export const SCOPE_LABELS: Record<string, string> = { company: "Whole company", function: "One function", level_and_above: "Seniority and above" };
export const REASON_LABELS: Record<string, string> = { current_client: "Current client", recent_placement: "Recent placement", contractual: "Contractual" };
export const SENIORITY_LABELS: Record<string, string> = { c_suite: "C-suite", svp: "SVP", vp: "VP", board: "Board", other: "Other" };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD.").refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "This is not a real date.");

export const offLimitsSchema = z
  .object({
    companyId: z.string().uuid("Choose a company."),
    scope: z.enum(SCOPES, { message: "Choose what the rule covers." }),
    function: z.string().trim().max(80).optional().transform((v) => v || null),
    minSeniority: z.enum(SENIORITIES).optional().nullable(),
    reason: z.enum(REASONS, { message: "Choose a reason." }),
    startsOn: isoDate,
    endsOn: isoDate.optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.scope === "function" && !v.function) ctx.addIssue({ code: "custom", path: ["function"], message: "Name the function the rule covers, for example Finance." });
    if (v.scope === "level_and_above" && !v.minSeniority) ctx.addIssue({ code: "custom", path: ["minSeniority"], message: "Choose the lowest seniority the rule covers." });
    if (v.endsOn && v.endsOn < v.startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "The end date is before the start date." });
  });

export type OffLimitsInput = z.infer<typeof offLimitsSchema>;

interface Actor {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

const can = (actor: Actor, capability: Capability) => assertCan(actor.role, capability);

export async function addOffLimitsRule(tx: Tx, actor: Actor, input: OffLimitsInput): Promise<string> {
  can(actor, "off_limits.set");
  const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, input.companyId)).limit(1);
  if (!company) throw new Error("That company is not in this workspace.");
  const [row] = await tx
    .insert(offLimits)
    .values({
      workspaceId: actor.workspaceId,
      companyId: input.companyId,
      scope: input.scope,
      function: input.scope === "function" ? input.function : null,
      minSeniority: input.scope === "level_and_above" ? (input.minSeniority ?? null) : null,
      reason: input.reason,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
      setBy: actor.userId,
    })
    .returning({ id: offLimits.id });
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "off_limits.added", entityType: "company", entityId: input.companyId, after: { rule_id: row!.id, ...input } });
  return row!.id;
}

const dayBefore = (iso: string) => new Date(new Date(`${iso}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);

/** Ends a rule so it no longer applies today. A rule that has not started yet is removed. */
export async function endOffLimitsRule(tx: Tx, actor: Actor, ruleId: string, today: string): Promise<void> {
  can(actor, "off_limits.set");
  const [rule] = await tx.select().from(offLimits).where(eq(offLimits.id, ruleId)).limit(1);
  if (!rule) throw new Error("That rule is not in this workspace.");
  if (rule.startsOn > dayBefore(today)) await tx.delete(offLimits).where(eq(offLimits.id, ruleId));
  else await tx.update(offLimits).set({ endsOn: dayBefore(today) }).where(eq(offLimits.id, ruleId));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "off_limits.ended", entityType: "company", entityId: rule.companyId, before: { rule_id: ruleId, ends_on: rule.endsOn }, after: { ends_on: dayBefore(today) } });
}

export type RuleState = "active" | "upcoming" | "ended";

export function ruleState(rule: { startsOn: string; endsOn: string | null }, today: string): RuleState {
  if (rule.startsOn > today) return "upcoming";
  if (rule.endsOn !== null && rule.endsOn < today) return "ended";
  return "active";
}

export async function listOffLimitsRules(tx: Tx) {
  return tx
    .select({ rule: offLimits, companyName: companies.name, setByName: users.name })
    .from(offLimits)
    .innerJoin(companies, eq(companies.id, offLimits.companyId))
    .leftJoin(users, eq(users.id, offLimits.setBy))
    .orderBy(asc(companies.name), asc(offLimits.startsOn));
}

/** Active rules ending within the reminder window (BRD 13: a 30-day expiry reminder in the digest). */
export async function rulesEndingSoon(tx: Tx, today: string, days = EXPIRY_REMINDER_DAYS) {
  const until = new Date(new Date(`${today}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
  return tx
    .select({ id: offLimits.id, companyId: offLimits.companyId, companyName: companies.name, endsOn: offLimits.endsOn, scope: offLimits.scope, function: offLimits.function, minSeniority: offLimits.minSeniority })
    .from(offLimits)
    .innerJoin(companies, eq(companies.id, offLimits.companyId))
    .where(and(isNotNull(offLimits.endsOn), gte(offLimits.endsOn, today), lte(offLimits.endsOn, until), lte(offLimits.startsOn, today)))
    .orderBy(asc(offLimits.endsOn));
}

const RANK_SQL = (col: string) => sql.raw(`(case ${col} when 'c_suite' then 4 when 'svp' then 3 when 'vp' then 2 when 'other' then 1 else 0 end)`);

/**
 * True when an active rule covers one of the person's current executive roles, the same test as
 * checks.ts `ruleCovers`, in SQL for lists and badges. `personId` is a SQL expression.
 */
export function offLimitsCoversSql(personId: ReturnType<typeof sql>, today: string) {
  return sql`exists (
    select 1 from dmi.roles olr join dmi.off_limits ol on ol.company_id = olr.company_id
    where olr.person_id = ${personId} and olr.status = 'current' and olr.seat_type not in ('board', 'advisory')
      and ol.starts_on <= ${today}::date and (ol.ends_on is null or ol.ends_on >= ${today}::date)
      and (ol.scope = 'company'
        or (ol.scope = 'function' and lower(ol.function) = lower(olr.function))
        or (ol.scope = 'level_and_above' and ${RANK_SQL("olr.seniority")} >= ${RANK_SQL("ol.min_seniority")})))`;
}

export function describeRule(r: { scope: string; function: string | null; minSeniority: string | null }): string {
  if (r.scope === "company") return "Whole company";
  if (r.scope === "function") return `${r.function ?? "One function"} function`;
  return `${SENIORITY_LABELS[r.minSeniority ?? ""] ?? "Senior"} and above`;
}
