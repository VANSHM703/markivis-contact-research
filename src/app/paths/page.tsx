import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Paths" };

export default function PathsPage() {
  return (
    <>
      <PageHeader title="Paths" lede="Find who can introduce you to a target." />
      <EmptyState message="Search for a person to see who can introduce you." />
    </>
  );
}
