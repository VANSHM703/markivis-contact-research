import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackImportBatch } from "@/components/pack/PackImport";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { execSearchOn } from "@/lib/packs";
import { allowed, pageContext, requireUuid } from "@/server/guards";

export const metadata: Metadata = { title: "Off-limits import" };

export default async function OffLimitsBatchPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<{ notice?: string }> }) {
  const ctx = await pageContext();
  if (!execSearchOn(ctx.workspace)) notFound();
  if (!allowed(ctx, "off_limits.set")) return <PermissionDenied who="partners" />;
  const { batchId } = await params;
  requireUuid(batchId);
  return <PackImportBatch kind="off_limits" workspaceId={ctx.workspace.id} batchId={batchId} notice={(await searchParams).notice} />;
}
