import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LogInteractionForm } from "@/components/capture/LogInteractionForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDenied } from "@/components/ui/PermissionDenied";
import { can } from "@/lib/permissions";
import { logInteractionAction } from "@/server/capture-actions";
import { getPerson } from "@/server/records";
import { allowed, pageContext, requireUuid } from "@/server/guards";

export const metadata: Metadata = { title: "Log interaction" };

/** The local date and time for a datetime-local field, in the workspace's time zone. */
function localNow(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export default async function LogInteractionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext();
  if (!allowed(ctx, "records.edit")) return <PermissionDenied who="partners, outreach owners and validators" />;
  const { id } = await params;
  requireUuid(id);
  const record = await getPerson(ctx.workspace.id, id);
  if (!record || record.mergedInto) notFound();
  return (
    <>
      <PageHeader title={`Log an interaction with ${record.person.fullName}`} lede="For a call, meeting or conversation that was not captured from a mailbox or calendar." />
      <LogInteractionForm action={logInteractionAction.bind(null, record.person.id)} now={localNow(ctx.workspace.timezone)} canPrivate={can(ctx.role, "privacy.mark_private")} />
    </>
  );
}
