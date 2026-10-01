import { SubmitButton } from "@/components/forms/SubmitButton";
import { formatTimeIn } from "@/lib/format/labels";
import { endBreakGlassAction } from "@/server/platform-actions";
import styles from "./BreakGlassBanner.module.css";

/** Shown on every page while a platform admin works through break-glass access (BRD 18.3). */
export function BreakGlassBanner({ workspaceName, grant, timezone }: { workspaceName: string; grant: { grantId: string; expiresAt: Date; reason: string }; timezone: string }) {
  return (
    <div className={`card card--accent ${styles.banner}`} role="status">
      <div>
        <p className={styles.title}>Break-glass access to {workspaceName}, read-only, until {formatTimeIn(grant.expiresAt, timezone)}</p>
        <p className="t-caption t-muted">Reason: {grant.reason}. Opening and ending this access is in the workspace&apos;s audit log, and its data stewards were emailed.</p>
      </div>
      <form action={endBreakGlassAction}>
        <input type="hidden" name="grant_id" value={grant.grantId} />
        <SubmitButton variant="ghost">End access now</SubmitButton>
      </form>
    </div>
  );
}
