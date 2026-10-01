import type { Metadata } from "next";
import styles from "@/components/compliance/Compliance.module.css";
import formStyles from "@/components/forms/Form.module.css";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { DataTable } from "@/components/ui/DataTable";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { BREAK_GLASS_MINUTES, platformOverview } from "@/domain/break-glass";
import { getSignedInUser } from "@/lib/context";
import { endBreakGlassAction, openWorkspaceAction, startBreakGlassAction } from "@/server/platform-actions";

export const metadata: Metadata = { title: "Platform" };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const user = (await getSignedInUser())!;
  const { notice } = await searchParams;
  const workspaces = await platformOverview(user.id);

  return (
    <>
      <Notice notice={notice} />
      <PageHeader title="Platform" lede="Every workspace, with its packs, members, usage and cost this month. You read a workspace's data only as a member, or through break-glass access: a stated reason, a time limit, read-only, written to that workspace's audit log and emailed to its data stewards." />
      <div className={styles.stack}>
        <DataTable
          caption="Workspaces"
          columns={[{ key: "name", label: "Workspace" }, { key: "members", label: "Members", numeric: true }, { key: "packs", label: "Packs" }, { key: "ai", label: "AI this month", numeric: true }, { key: "apollo", label: "Apollo credits", numeric: true }, { key: "access", label: "Access" }]}
          rows={workspaces.map((w) => ({
            id: w.id,
            cells: {
              name: (
                <>
                  <span className="cell-title">{w.name}</span>
                  <span className="cell-sub">{w.slug}{w.flags["pipeline.shadow"] ? ", shadow run" : ""}</span>
                </>
              ),
              members: w.members,
              packs: [w.packs.exec_search ? "Executive search" : null, w.packs.pe_mapping ? "PE mapping" : null].filter(Boolean).join(", ") || "None",
              ai: usd.format(w.aiSpendUsd),
              apollo: w.apolloCredits,
              access: w.isMember ? (
                <form action={openWorkspaceAction}>
                  <input type="hidden" name="workspace_id" value={w.id} />
                  <SubmitButton variant="ghost" compact>Open</SubmitButton>
                </form>
              ) : w.grant ? (
                <div className={styles.cellActions}>
                  <form action={openWorkspaceAction}>
                    <input type="hidden" name="workspace_id" value={w.id} />
                    <SubmitButton variant="ghost" compact>Open read-only</SubmitButton>
                  </form>
                  <form action={endBreakGlassAction}>
                    <input type="hidden" name="grant_id" value={w.grant.id} />
                    <SubmitButton variant="danger" compact>End access</SubmitButton>
                  </form>
                </div>
              ) : (
                <details className={styles.inline}>
                  <summary>Break-glass access</summary>
                  <form action={startBreakGlassAction} className={formStyles.stack}>
                    <input type="hidden" name="workspace_id" value={w.id} />
                    <label className={formStyles.field}>
                      <span className={formStyles.label}>Reason</span>
                      <textarea name="reason" rows={3} required minLength={10} maxLength={500} placeholder="For example: support ticket 4411, the client reports a missing signal" className={`${formStyles.input} ${formStyles.textarea}`} />
                    </label>
                    <label className={formStyles.field}>
                      <span className={formStyles.label}>For</span>
                      <select name="minutes" defaultValue="60" className={formStyles.input}>
                        {BREAK_GLASS_MINUTES.map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} ${m === 60 ? "hour" : "hours"}`}</option>)}
                      </select>
                    </label>
                    <SubmitButton variant="danger">Open read-only access</SubmitButton>
                  </form>
                </details>
              ),
            },
          }))}
        />
      </div>
    </>
  );
}
