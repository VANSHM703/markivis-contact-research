import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackImportStart } from "@/components/pack/PackImport";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { execSearchOn } from "@/lib/packs";
import { allowed, pageContext } from "@/server/guards";

export const metadata: Metadata = { title: "Import placements" };

export default async function ImportPlacementsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const ctx = await pageContext();
  if (!execSearchOn(ctx.workspace)) notFound();
  if (!allowed(ctx, "records.edit")) return <PermissionDenied who="partners, outreach owners and validators" />;
  return <PackImportStart kind="placements" notice={(await searchParams).notice} />;
}
