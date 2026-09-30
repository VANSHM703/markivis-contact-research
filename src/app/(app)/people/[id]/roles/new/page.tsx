import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RoleForm } from "@/components/records/RoleForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { addRoleAction } from "@/server/record-actions";
import { getPerson } from "@/server/records";
import { allowed, pageContext, requireUuid } from "@/server/guards";

export const metadata: Metadata = { title: "Add role" };

export default async function AddRolePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "records.edit")) return <PermissionDenied who="partners, outreach owners and validators" />;
  const { id } = await params;
  requireUuid(id);
  const record = await getPerson(ctx.workspace.id, id);
  if (!record || record.mergedInto) notFound();
  return (
    <>
      <PageHeader title={`Add a role for ${record.person.fullName}`} lede="Existing roles stay as they are, so a new board seat never ends another." />
      <RoleForm action={addRoleAction.bind(null, record.person.id)} />
    </>
  );
}
