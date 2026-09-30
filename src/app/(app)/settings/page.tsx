import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { getRequestContext } from "@/lib/context";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await getRequestContext();
  const allowed = ctx ? can(ctx.role, "settings.change") : false;
  return (
    <>
      <PageHeader title="Settings" lede="Members, connections, sources, scoring and compliance for this workspace." />
      {allowed ? <EmptyState message="No settings to show yet." /> : <PermissionDenied who="partners and data stewards" />}
    </>
  );
}
