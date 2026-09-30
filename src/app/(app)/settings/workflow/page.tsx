import type { Metadata } from "next";
import Link from "next/link";
import formStyles from "@/components/forms/Form.module.css";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { allowed, pageContext } from "@/server/guards";
import { saveStyleGuideAction, saveWorkflowAction } from "@/server/settings-actions";
import styles from "@/components/settings/Settings.module.css";

export const metadata: Metadata = { title: "Service levels and style guide" };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Settings {
  sla?: { p1_working_days?: number; p2_working_days?: number; announced_lead_working_days?: number };
  digest_time?: string;
  working_days?: string[];
  send?: { max_per_day?: number };
  style_guide?: string;
}

export default async function WorkflowSettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "settings.change")) return <PermissionDenied who="partners and data stewards" />;
  const { notice } = await searchParams;
  const s = ctx.workspace.settings as Settings;
  const workingDays = s.working_days ?? DAYS.slice(0, 5);

  return (
    <>
      <Notice notice={notice} />
      <PageHeader title="Service levels and style guide" lede="When actions are due, when the digest goes out, how many emails a mailbox sends a day, and how drafts are written." />
      <p className="t-caption"><Link href="/settings">Back to Settings</Link></p>
      <div className={styles.stack}>
        <section className="card" aria-labelledby="sla-heading">
          <h2 id="sla-heading" className="t-heading-card">Service levels and digest</h2>
          <form action={saveWorkflowAction} className={formStyles.stack}>
            <div className={formStyles.grid}>
              <label className={formStyles.field}>
                <span className={formStyles.label}>Priority 1 due, working days</span>
                <input type="number" name="p1" min={1} max={20} required defaultValue={s.sla?.p1_working_days ?? 2} className={formStyles.input} />
              </label>
              <label className={formStyles.field}>
                <span className={formStyles.label}>Priority 2 due, working days</span>
                <input type="number" name="p2" min={1} max={30} required defaultValue={s.sla?.p2_working_days ?? 5} className={formStyles.input} />
              </label>
              <label className={formStyles.field}>
                <span className={formStyles.label}>Announced move, working days before it starts</span>
                <input type="number" name="lead" min={0} max={20} required defaultValue={s.sla?.announced_lead_working_days ?? 2} className={formStyles.input} />
              </label>
              <label className={formStyles.field}>
                <span className={formStyles.label}>Daily digest time</span>
                <input type="time" name="digest_time" required defaultValue={s.digest_time ?? "08:00"} className={formStyles.input} />
                <span className={formStyles.help}>In {ctx.workspace.timezone.replace("_", " ")} time.</span>
              </label>
              <label className={formStyles.field}>
                <span className={formStyles.label}>Emails per mailbox per day</span>
                <input type="number" name="max_per_day" min={1} max={200} required defaultValue={s.send?.max_per_day ?? 25} className={formStyles.input} />
              </label>
              <fieldset className={`${formStyles.fieldset} ${formStyles.field} ${formStyles.wide}`}>
                <legend className={formStyles.label}>Working days</legend>
                <div className={formStyles.checks}>
                  {DAYS.map((d) => (
                    <label key={d} className={formStyles.check}>
                      <input type="checkbox" name="working_days" value={d} defaultChecked={workingDays.includes(d)} />
                      {d}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <p className={formStyles.help}>An action overdue by one working day is escalated to the top of Today and the digest.</p>
            <div className={formStyles.actions}>
              <SubmitButton>Save service levels</SubmitButton>
            </div>
          </form>
        </section>

        <section className="card" aria-labelledby="style-heading">
          <h2 id="style-heading" className="t-heading-card">Style guide</h2>
          <form action={saveStyleGuideAction} className={formStyles.stack}>
            <label className={formStyles.field}>
              <span className={formStyles.label}>How drafts are written</span>
              <textarea name="style_guide" rows={8} required minLength={40} maxLength={4000} defaultValue={s.style_guide ?? ""} className={`${formStyles.input} ${formStyles.textarea}`} />
              <span className={formStyles.help}>Word limits written as &quot;Email: 120 words maximum&quot; and &quot;LinkedIn: 60 words maximum&quot; also set the counter in the draft editor.</span>
            </label>
            <div className={formStyles.actions}>
              <SubmitButton>Save style guide</SubmitButton>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
