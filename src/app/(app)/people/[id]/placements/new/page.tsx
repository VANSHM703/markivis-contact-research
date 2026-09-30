import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlacementForm } from "@/components/pack/PlacementForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { execSearchOn } from "@/lib/packs";
import { addPlacementAction } from "@/server/pack-actions";
import { getPerson } from "@/server/records";
import { allowed, pageContext, requireUuid } from "@/server/guards";

export const metadata: Metadata = { title: "Record placement" };

export default async function NewPlacementPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext();
  if (!execSearchOn(ctx.workspace)) notFound();
  if (!allowed(ctx, "records.edit")) return <PermissionDenied who="partners, outreach owners and validators" />;
  const { id } = await params;
  requireUuid(id);
  const record = await getPerson(ctx.workspace.id, id);
  if (!record || record.mergedInto) notFound();
  const primary = record.roles.find((r) => r.isPrimary);
  return (
    <>
      <PageHeader title={`Record a placement for ${record.person.fullName}`} lede="Placed executives are priority 1 on every move, and their leaving also prompts a backfill check-in at the company they leave." />
      <PlacementForm action={addPlacementAction.bind(null, record.person.id)} company={primary ? { id: primary.companyId, name: primary.companyName } : null} title={primary?.title ?? ""} />
    </>
  );
}
