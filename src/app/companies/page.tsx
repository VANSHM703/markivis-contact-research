import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Companies" };

export default function CompaniesPage() {
  return (
    <>
      <PageHeader title="Companies" lede="Target companies, their leadership and board, and recent signals." />
      <EmptyState message="No companies yet. Import your target list." />
    </>
  );
}
