import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompanyForm } from "@/components/records/CompanyForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { updateCompanyAction } from "@/server/record-actions";
import { getCompany } from "@/server/records";
import { allowed, pageContext, requireUuid } from "@/server/guards";

export const metadata: Metadata = { title: "Edit company" };

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "records.edit")) return <PermissionDenied who="partners, outreach owners and validators" />;
  const { id } = await params;
  requireUuid(id);
  const record = await getCompany(ctx.workspace.id, id);
  if (!record) notFound();
  const c = record.company;
  return (
    <>
      <PageHeader title={`Edit ${c.name}`} lede="Name, domain and CIK keep their previous values and sources." />
      <CompanyForm
        action={updateCompanyAction.bind(null, c.id)}
        defaults={{
          name: c.name,
          domain: c.domain,
          ticker: c.aliases[0] ?? "",
          sec_cik: c.secCik,
          ownership: c.ownership,
          target_tier: c.targetTier ? String(c.targetTier) : "",
          industry: c.industry,
          hq_country: c.hqCountry,
          employee_count: c.employeeCount !== null ? String(c.employeeCount) : "",
          client_status: c.clientStatus,
          is_sponsor: c.isSponsor,
        }}
        submitLabel="Save changes"
      />
    </>
  );
}
