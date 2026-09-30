import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { PersonForm } from "@/components/records/PersonForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { withWorkspace } from "@/db/client";
import { companies } from "@/db/schema";
import { createPersonAction } from "@/server/record-actions";
import { allowed, pageContext, UUID_RE } from "@/server/guards";

export const metadata: Metadata = { title: "Add person" };

export default async function NewPersonPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "records.edit")) return <PermissionDenied who="partners, outreach owners and validators" />;
  const { company } = await searchParams;
  const defaultCompany =
    company && UUID_RE.test(company)
      ? ((await withWorkspace(ctx.workspace.id, (tx) => tx.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, company)).limit(1)))[0] ?? null)
      : null;
  return (
    <>
      <PageHeader title="Add person" lede="Checked against everyone in the workspace first, so the same person is never added twice." />
      <PersonForm action={createPersonAction} withRole defaultCompany={defaultCompany} submitLabel="Add person" />
    </>
  );
}
