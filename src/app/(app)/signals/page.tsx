import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Signals" };

export default function SignalsPage() {
  return (
    <>
      <PageHeader title="Signals" lede="Every confirmed change, with its sources." />
      <EmptyState message="No confirmed signals in this period." />
    </>
  );
}
