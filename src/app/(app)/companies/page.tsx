import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { getRequestContext } from "@/lib/context";
import { CLIENT_STATUS_LABELS, OWNERSHIP_LABELS, pageParam } from "@/lib/format/labels";
import { listCompanies, PAGE_SIZE } from "@/server/records";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  const page = pageParam((await searchParams).page);
  const { rows, total } = await listCompanies(ctx.workspace.id, page);

  return (
    <>
      <PageHeader title="Companies" lede={`${total} companies: targets by tier, clients and PE sponsors.`} />
      {total === 0 ? (
        <EmptyState message="No companies yet. Import your target list." />
      ) : (
        <DataTable
          caption="Companies"
          columns={[
            { key: "name", label: "Name" },
            { key: "tier", label: "Tier", numeric: true },
            { key: "ownership", label: "Ownership" },
            { key: "client", label: "Client status" },
            { key: "people", label: "People", numeric: true },
          ]}
          rows={rows.map((c) => ({
            id: c.id,
            href: `/companies/${c.id}`,
            cells: {
              name: (
                <>
                  <span className="cell-title">{c.name}</span>
                  <span className="cell-sub">{c.isSponsor ? "PE sponsor" : c.industry}</span>
                </>
              ),
              tier: c.targetTier ?? "",
              ownership: OWNERSHIP_LABELS[c.ownership] ?? c.ownership,
              client: CLIENT_STATUS_LABELS[c.clientStatus] ?? c.clientStatus,
              people: c.peopleCount,
            },
          }))}
          pagination={{ page, total, pageSize: PAGE_SIZE, path: "/companies" }}
        />
      )}
    </>
  );
}
