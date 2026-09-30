import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" lede="Members, connections, sources, scoring and compliance for this workspace." />
      <EmptyState message="No settings to show yet." />
    </>
  );
}
