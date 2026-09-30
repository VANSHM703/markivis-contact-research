import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Chip } from "@/components/ui/Chip";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { getRequestContext } from "@/lib/context";
import { CONTACT_TYPE_LABELS, pageParam } from "@/lib/format/labels";
import { listPeople, PAGE_SIZE } from "@/server/records";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  const page = pageParam((await searchParams).page);
  const { rows, total } = await listPeople(ctx.workspace.id, page);

  return (
    <>
      <PageHeader title="People" lede={`${total} tracked decision-makers, with their primary role and flags.`} />
      {total === 0 ? (
        <EmptyState message="No people yet. Import your target list or add a person." />
      ) : (
        <DataTable
          caption="People"
          columns={[
            { key: "name", label: "Name" },
            { key: "company", label: "Company" },
            { key: "types", label: "Contact type" },
            { key: "flags", label: "Flags" },
          ]}
          rows={rows.map((p) => ({
            id: p.id,
            href: `/people/${p.id}`,
            cells: {
              name: (
                <>
                  <span className="cell-title">{p.fullName}</span>
                  <span className="cell-sub">{p.title ?? "No current role"}</span>
                </>
              ),
              company: p.companyName ?? "",
              types: p.contactTypes.map((t) => CONTACT_TYPE_LABELS[t] ?? t).join(", "),
              flags: (
                <>
                  {p.isPlaced ? <Chip>Placed</Chip> : null}
                  {p.status === "do_not_contact" ? <Chip tone="blocked">Do not contact</Chip> : null}
                  {p.isOffList ? <Chip>Off list</Chip> : null}
                </>
              ),
            },
          }))}
          pagination={{ page, total, pageSize: PAGE_SIZE, path: "/people" }}
        />
      )}
    </>
  );
}
