import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar } from "@/components/ui/FilterBar";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { getRequestContext } from "@/lib/context";
import { CLIENT_STATUS_LABELS, OWNERSHIP_LABELS, pageParam } from "@/lib/format/labels";
import { can } from "@/lib/permissions";
import { CLIENT_STATUS_OPTIONS, OWNERSHIP_OPTIONS } from "@/server/forms";
import { filterQuery, listCompanies, PAGE_SIZE, parseCompanyFilters } from "@/server/records";

export const metadata: Metadata = { title: "Companies" };

const FILTER_KEYS = ["q", "tier", "ownership", "client_status", "sponsor"];

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  const params = await searchParams;
  const page = pageParam(params.page);
  const filters = parseCompanyFilters(params);
  const { rows, total } = await listCompanies(ctx.workspace.id, page, filters);
  const filtered = FILTER_KEYS.some((k) => params[k]);
  const editor = can(ctx.role, "records.edit");

  return (
    <>
      <Notice notice={params.notice} />
      <PageHeader
        title="Companies"
        lede={filtered ? `${total} companies match these filters.` : `${total} companies: targets by tier, clients and PE sponsors.`}
        actions={
          editor ? (
            <>
              <Link href="/people/import" className="btn btn--ghost">Import target list</Link>
              <Link href="/companies/new" className="btn btn--primary">Add company</Link>
            </>
          ) : undefined
        }
      />
      <FilterBar
        path="/companies"
        searchLabel="Name, domain or ticker"
        values={{ q: filters.q, tier: filters.tier ? String(filters.tier) : undefined, ownership: filters.ownership, client_status: filters.clientStatus, sponsor: filters.sponsor ? "yes" : undefined }}
        selects={[
          { name: "tier", label: "Target tier", options: [{ value: "1", label: "Tier 1" }, { value: "2", label: "Tier 2" }, { value: "3", label: "Tier 3" }] },
          { name: "ownership", label: "Ownership", options: OWNERSHIP_OPTIONS.filter((o) => o.value !== "unknown") },
          { name: "client_status", label: "Client status", options: CLIENT_STATUS_OPTIONS },
          { name: "sponsor", label: "PE sponsors", options: [{ value: "yes", label: "Sponsors only" }] },
        ]}
      />
      {total === 0 ? (
        filtered ? (
          <EmptyState message="No companies match these filters." actions={<Link href="/companies" className="btn btn--ghost">Clear all filters</Link>} />
        ) : (
          <EmptyState message="No companies yet. Import your target list." actions={editor ? <Link href="/people/import" className="btn btn--primary">Import target list</Link> : undefined} />
        )
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
          pagination={{ page, total, pageSize: PAGE_SIZE, path: "/companies", query: filterQuery(params, FILTER_KEYS) }}
        />
      )}
    </>
  );
}
