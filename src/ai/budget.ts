/**
 * AI spend per workspace and month (BRD 17.2). At 80% the data steward and platform admin are
 * alerted (recorded now, emailed from M5). At 100%, research cycles, automatic briefs and priority
 * 2 drafts pause; extraction and priority 1 drafts continue. It resets on the first of the month.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { aiCalls, auditLog } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AiCallRecord } from "./adapter";

export type AiWork = "extract" | "draft_p1" | "draft_p2" | "research" | "brief";
const PAUSED_AT_CAP: AiWork[] = ["draft_p2", "research", "brief"];

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export async function monthlySpend(tx: Tx, now: Date): Promise<number> {
  const [row] = await tx.select({ usd: sql<string>`coalesce(sum(${aiCalls.costUsd}), 0)` }).from(aiCalls).where(gte(aiCalls.createdAt, monthStart(now)));
  return Number(row?.usd ?? 0);
}

export function budgetOf(settings: Record<string, unknown>): number {
  return Number((settings.ai as { monthly_budget_usd?: number } | undefined)?.monthly_budget_usd ?? 250);
}

export class AiBudgetPausedError extends Error {
  constructor(public readonly work: AiWork) {
    super("The monthly AI budget is used up, so this work is paused until the first of next month or until the budget is raised in Settings.");
  }
}

export async function assertAiAllowed(tx: Tx, settings: Record<string, unknown>, work: AiWork, now: Date): Promise<void> {
  if (!PAUSED_AT_CAP.includes(work)) return;
  if ((await monthlySpend(tx, now)) >= budgetOf(settings)) throw new AiBudgetPausedError(work);
}

export async function recordAiCall(tx: Tx, workspaceId: string, call: AiCallRecord, settings: Record<string, unknown>, now: Date): Promise<void> {
  await tx.insert(aiCalls).values({
    workspaceId,
    purpose: call.purpose,
    model: call.model,
    promptVersion: call.promptVersion,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    costUsd: call.costUsd === null ? null : String(call.costUsd),
    latencyMs: call.latencyMs,
    status: call.status,
    error: call.error?.slice(0, 1000) ?? null,
  });
  if (!call.costUsd) return;
  const budget = budgetOf(settings);
  const spent = await monthlySpend(tx, now);
  if (spent < budget * 0.8) return;
  const [alerted] = await tx.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.action, "ai.budget_80"), gte(auditLog.at, monthStart(now)))).limit(1);
  if (!alerted) await audit(tx, { workspaceId, actorUserId: null, actorKind: "system", action: "ai.budget_80", after: { spent_usd: spent, budget_usd: budget } });
}
