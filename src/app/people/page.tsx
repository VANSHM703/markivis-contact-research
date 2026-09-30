import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "People" };

export default function PeoplePage() {
  return (
    <>
      <PageHeader title="People" lede="Every tracked decision-maker, with their roles and relationship band." />
      <EmptyState message="No people yet. Import your target list or add a person." />
    </>
  );
}
