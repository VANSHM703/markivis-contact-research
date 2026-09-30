import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Actions" };

export default function ActionsPage() {
  return (
    <>
      <PageHeader title="Actions" lede="Work the action list: approve drafts, send and record outcomes." />
      <EmptyState message="No open actions. Confirmed changes create actions automatically." />
    </>
  );
}
