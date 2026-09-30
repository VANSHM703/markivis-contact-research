import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { OffLimitsForm } from "@/components/pack/OffLimitsForm";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { StatePill } from "@/components/ui/Priority";
import { withWorkspace } from "@/db/client";
import { companies } from "@/db/schema";
import { describeRule, EXPIRY_REMINDER_DAYS, listOffLimitsRules, REASON_LABELS, ruleState } from "@/domain/off-limits";
import { formatDate } from "@/lib/format/labels";
import { execSearchOn } from "@/lib/packs";
import { localDate } from "@/lib/working-days";
import { addOffLimitsAction, endOffLimitsAction } from "@/server/pack-actions";
import { allowed, pageContext, UUID_RE } from "@/server/guards";
import styles from "@/components/settings/Settings.module.css";

export const metadata: Metadata = { title: "Off-limits rules" };

const addDays = (iso: string, days: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

/** Partner-only screen for off-limits rules (BRD 13). */
export default async function OffLimitsPage({ searchParams }: { searchParams: Promise<{ notice?: string; company?: string }> }) {
  const ctx = await pageContext();
  if (!execSearchOn(ctx.workspace)) notFound();
  if (!allowed(ctx, "off_limits.set")) return <PermissionDenied who="partners" />;
  const { notice, company } = await searchParams;
  const today = localDate(new Date(), ctx.workspace.timezone);
  const [rules, preset] = await withWorkspace(ctx.workspace.id, async (tx) => [
    await listOffLimitsRules(tx),
    company && UUID_RE.test(company) ? ((await tx.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, company)).limit(1))[0] ?? null) : null,
  ] as const);
  const current = rules.filter((r) => ruleState(r.rule, today) !== "ended");
  const ended = rules.filter((r) => ruleState(r.rule, today) === "ended");
  const soon = addDays(today, EXPIRY_REMINDER_DAYS);

  const table = (list: typeof rules, caption: string, endable: boolean) => (
    <DataTable
      caption={caption}
      columns={[
        { key: "company", label: "Company" },
        { key: "covers", label: "Covers" },
        { key: "dates", label: "Dates" },
        { key: "state", label: "State" },
        ...(endable ? [{ key: "end", label: "End" }] : []),
      ]}
      rows={list.map(({ rule, companyName, setByName }) => {
        const state = ruleState(rule, today);
        return {
          id: rule.id,
          cells: {
            company: (
              <>
                <Link href={`/companies/${rule.companyId}`} className="cell-title">{companyName}</Link>
                {setByName ? <span className="cell-sub">Set by {setByName}</span> : null}
              </>
            ),
            covers: (
              <>
                <span>{describeRule(rule)}</span>
                <span className="cell-sub">{REASON_LABELS[rule.reason] ?? rule.reason}</span>
              </>
            ),
            dates: (
              <>
                <span className="t-meta">From {formatDate(rule.startsOn)}</span>
                <span className="cell-sub">{rule.endsOn ? `To ${formatDate(rule.endsOn)}` : "No end date"}</span>
              </>
            ),
            state:
              state === "upcoming" ? <StatePill tone="neutral">Starts later</StatePill>
              : state === "ended" ? <StatePill tone="neutral">Ended</StatePill>
              : rule.endsOn && rule.endsOn <= soon ? <StatePill tone="warn">Ends within 30 days</StatePill>
              : <StatePill tone="blocked">Active</StatePill>,
            ...(endable
              ? {
                  end: (
                    <form action={endOffLimitsAction.bind(null, rule.id)}>
                      <SubmitButton variant="ghost" compact>{state === "upcoming" ? "Remove" : "End today"}</SubmitButton>
                    </form>
                  ),
                }
              : {}),
          },
        };
      })}
    />
  );

  return (
    <>
      <Notice notice={notice} />
      <PageHeader
        title="Off-limits rules"
        lede="Companies whose executives are not approached as candidates, by scope, reason and dates. Client approaches stay allowed."
        actions={<Link href="/settings/off-limits/import" className="btn btn--ghost">Import rules</Link>}
      />
      <div className={styles.stack}>
        <section className="card" aria-labelledby="add-rule">
          <h2 id="add-rule" className="t-heading-card">Add a rule</h2>
          <OffLimitsForm action={addOffLimitsAction} today={today} company={preset} />
        </section>
        {current.length ? table(current, "Active and upcoming rules", true) : <EmptyState message="No off-limits rules. Add one above, or import them from a file." />}
        {ended.length ? table(ended, "Ended rules", false) : null}
      </div>
    </>
  );
}
