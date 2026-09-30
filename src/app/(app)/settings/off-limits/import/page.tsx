import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackImportStart } from "@/components/pack/PackImport";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { execSearchOn } from "@/lib/packs";
import { allowed, pageContext } from "@/server/guards";

export const metadata: Metadata = { title: "Import off-limits rules" };

export default async function ImportOffLimitsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const ctx = await pageContext();
  if (!execSearchOn(ctx.workspace)) notFound();
  if (!allowed(ctx, "off_limits.set")) return <PermissionDenied who="partners" />;
  return <PackImportStart kind="off_limits" notice={(await searchParams).notice} />;
}
