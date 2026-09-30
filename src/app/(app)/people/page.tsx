import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip } from "@/components/ui/Chip";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar } from "@/components/ui/FilterBar";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { getRequestContext } from "@/lib/context";
import { execSearchOn } from "@/lib/packs";
import { localDate } from "@/lib/working-days";
import { CONTACT_TYPE_LABELS, pageParam } from "@/lib/format/labels";
import { can } from "@/lib/permissions";
import { CONTACT_TYPE_OPTIONS, OWNERSHIP_OPTIONS, SEAT_TYPE_OPTIONS } from "@/server/forms";
import { filterQuery, listPeople, PAGE_SIZE, parsePeopleFilters } from "@/server/records";

export const metadata: Metadata = { title: "People" };

const FILTER_KEYS = ["q", "contact_type", "tier", "ownership", "seat_type", "flag", "company"];

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  const params = await searchParams;
  const page = pageParam(params.page);
  const filters = parsePeopleFilters(params);
  // Contact types, placements and off-limits belong to the executive search pack (BRD 13).
  const packOn = execSearchOn(ctx.workspace);
  if (!packOn) {
    filters.contactType = undefined;
    if (filters.flag === "placed" || filters.flag === "off_limits") filters.flag = undefined;
  }
  const { rows, total } = await listPeople(ctx.workspace.id, page, filters, localDate(new Date(), ctx.workspace.timezone));
  const filtered = FILTER_KEYS.some((k) => params[k]);
  const editor = can(ctx.role, "records.edit");

  return (
    <>
      <Notice notice={params.notice} />
      <PageHeader
        title="People"
        lede={filtered ? `${total} people match these filters.` : `${total} tracked decision-makers, with their primary role and flags.`}
        actions={
          editor ? (
            <>
              <Link href="/people/import" className="btn btn--ghost">Import target list</Link>
              {packOn ? <Link href="/people/placements/import" className="btn btn--ghost">Import placements</Link> : null}
              <Link href="/people/new" className="btn btn--primary">Add person</Link>
            </>
          ) : undefined
        }
      />
      <FilterBar
        path="/people"
        searchLabel="Name or company"
        values={{ q: filters.q, contact_type: filters.contactType, tier: filters.tier ? String(filters.tier) : undefined, ownership: filters.ownership, seat_type: filters.seatType, flag: filters.flag }}
        selects={[
          ...(packOn ? [{ name: "contact_type", label: "Contact type", options: CONTACT_TYPE_OPTIONS }] : []),
          { name: "tier", label: "Target tier", options: [{ value: "1", label: "Tier 1" }, { value: "2", label: "Tier 2" }, { value: "3", label: "Tier 3" }] },
          { name: "ownership", label: "Ownership", options: OWNERSHIP_OPTIONS.filter((o) => o.value !== "unknown") },
          { name: "seat_type", label: "Seat", options: SEAT_TYPE_OPTIONS.filter((o) => o.value) },
          {
            name: "flag",
            label: "Flag",
            options: [
              { value: "priority", label: "Tier 1 priority" },
              ...(packOn ? [{ value: "placed", label: "Placed" }, { value: "off_limits", label: "Off-limits" }] : []),
              { value: "do_not_contact", label: "Do not contact" },
              { value: "off_list", label: "Off list" },
              { value: "no_current_role", label: "No current role" },
            ],
          },
        ]}
      />
      {total === 0 ? (
        filtered ? (
          <EmptyState message="No people match these filters." actions={<Link href="/people" className="btn btn--ghost">Clear all filters</Link>} />
        ) : (
          <EmptyState
            message="No people yet. Import your target list or add a person."
            actions={editor ? (<><Link href="/people/import" className="btn btn--primary">Import target list</Link><Link href="/people/new" className="btn btn--ghost">Add person</Link></>) : undefined}
          />
        )
      ) : (
        <DataTable
          caption="People"
          columns={[
            { key: "name", label: "Name" },
            { key: "company", label: "Company" },
            ...(packOn ? [{ key: "types", label: "Contact type" }] : []),
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
              ...(packOn ? { types: p.contactTypes.map((t) => CONTACT_TYPE_LABELS[t] ?? t).join(", ") } : {}),
              flags: (
                <>
                  {p.isPriority ? <Chip>Tier 1</Chip> : null}
                  {packOn && p.isPlaced ? <Chip>Placed</Chip> : null}
                  {packOn && p.isOffLimits ? <Chip tone="blocked">Off-limits</Chip> : null}
                  {p.status === "do_not_contact" ? <Chip tone="blocked">Do not contact</Chip> : null}
                  {p.status === "no_current_role" ? <Chip>No current role</Chip> : null}
                  {p.isOffList ? <Chip>Off list</Chip> : null}
                </>
              ),
            },
          }))}
          pagination={{ page, total, pageSize: PAGE_SIZE, path: "/people", query: filterQuery(params, FILTER_KEYS) }}
        />
      )}
    </>
  );
}
