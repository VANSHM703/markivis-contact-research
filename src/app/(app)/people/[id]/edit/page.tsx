import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PersonForm } from "@/components/records/PersonForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { updatePersonAction } from "@/server/record-actions";
import { getPerson } from "@/server/records";
import { allowed, pageContext, requireUuid } from "@/server/guards";

export const metadata: Metadata = { title: "Edit person" };

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "records.edit")) return <PermissionDenied who="partners, outreach owners and validators" />;
  const { id } = await params;
  requireUuid(id);
  const record = await getPerson(ctx.workspace.id, id);
  if (!record || record.mergedInto) notFound();
  const p = record.person;
  return (
    <>
      <PageHeader title={`Edit ${p.fullName}`} lede="Your change is shown on the record; the previous value and its source are kept." />
      <PersonForm
        action={updatePersonAction.bind(null, p.id)}
        defaults={{ full_name: p.fullName, preferred_name: p.preferredName, linkedin_url: p.linkedinUrl, city: p.city, region: p.region, country: p.country, contact_types: p.contactTypes, is_priority: p.isPriority }}
        submitLabel="Save changes"
      />
    </>
  );
}
