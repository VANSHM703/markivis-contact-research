import type { Metadata } from "next";
import { CompanyForm } from "@/components/records/CompanyForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { createCompanyAction } from "@/server/record-actions";
import { allowed, pageContext } from "@/server/guards";

export const metadata: Metadata = { title: "Add company" };

export default async function NewCompanyPage() {
  const ctx = await pageContext();
  if (!allowed(ctx, "records.edit")) return <PermissionDenied who="partners, outreach owners and validators" />;
  return (
    <>
      <PageHeader title="Add company" lede="Checked by domain, SEC CIK, name and ticker first, so the same company is never added twice." />
      <CompanyForm action={createCompanyAction} submitLabel="Add company" />
    </>
  );
}
