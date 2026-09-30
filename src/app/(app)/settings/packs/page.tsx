import type { Metadata } from "next";
import formStyles from "@/components/forms/Form.module.css";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { execSearchOn } from "@/lib/packs";
import { pageContext } from "@/server/guards";
import { setPacksAction } from "@/server/pack-actions";

export const metadata: Metadata = { title: "Packs" };

/** Packs per workspace, set by platform admins only (BRD 5.3, 13, 16.2). */
export default async function PacksPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const ctx = await pageContext();
  if (!ctx.user.isPlatformAdmin) return <PermissionDenied who="platform admins" />;
  const { notice } = await searchParams;
  const pe = (ctx.workspace.packs as Record<string, unknown>).pe_mapping === true;
  return (
    <>
      <Notice notice={notice} />
      <PageHeader title="Packs" lede={`Modules switched on for ${ctx.workspace.name}. Switching a pack off hides its screens and skips its checks; its data is kept.`} />
      <form action={setPacksAction} className={`card ${formStyles.stack}`}>
        <fieldset className={formStyles.fieldset}>
          <legend className="t-heading-card">Workspace packs</legend>
          <div className={formStyles.section}>
            <label className={formStyles.check}>
              <input type="checkbox" name="exec_search" defaultChecked={execSearchOn(ctx.workspace)} />
              Executive search: contact types, off-limits rules, placements, confidential mandate notes, succession watch
            </label>
            <label className={formStyles.check}>
              <input type="checkbox" name="pe_mapping" defaultChecked={pe} />
              PE sponsor mapping (Release 3: only the data model exists today)
            </label>
          </div>
        </fieldset>
        <div className={formStyles.actions}>
          <SubmitButton>Save packs</SubmitButton>
        </div>
      </form>
    </>
  );
}
