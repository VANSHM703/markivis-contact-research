import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { getRequestContext } from "@/lib/context";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Queue" };

export default async function QueuePage() {
  const ctx = await getRequestContext();
  const allowed = ctx ? can(ctx.role, "queue.work") : false;
  return (
    <>
      <PageHeader title="Queue" lede="Validate detected changes before they reach the partner." />
      {allowed ? <EmptyState message="The queue is clear." /> : <PermissionDenied who="partners and validators" />}
    </>
  );
}
