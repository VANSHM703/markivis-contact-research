import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Queue" };

export default function QueuePage() {
  return (
    <>
      <PageHeader title="Queue" lede="Validate detected changes before they reach the partner." />
      <EmptyState message="The queue is clear." />
    </>
  );
}
