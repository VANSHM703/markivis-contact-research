"use server";

/** "Prepare a brief" on a person page (BRD 12.6: briefs are also available on demand). */
import { redirect } from "next/navigation";
import { generateBrief } from "@/domain/briefs";
import { getRequestContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { UUID_RE } from "./guards";

export async function prepareBriefAction(personId: string): Promise<void> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!UUID_RE.test(personId)) redirect("/people");
  if (!can(ctx.role, "messages.send")) redirect(`/people/${personId}?tab=brief&notice=not_allowed`);
  const outcome = await generateBrief(ctx.workspace.id, personId, { actorUserId: ctx.user.id });
  redirect(outcome.kind === "made" ? `/people/${personId}?tab=brief&brief=${outcome.briefId}&notice=brief_ready` : `/people/${personId}?tab=brief&notice=brief_failed`);
}
