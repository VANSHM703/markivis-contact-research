"use server";

/** The data steward's actions (BRD 18): consent, do not contact, suppression, retention, erasure. */
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/forms/FormState";
import { withWorkspace } from "@/db/client";
import { persons } from "@/db/schema";
import { addManualSuppression, checkSuppression, CONSENT_CHANNELS, CONSENT_PURPOSES, CONSENT_STATUSES, ConsentError, recordConsent, removeManualSuppression, setDoNotContact } from "@/domain/consent";
import { erasePerson, ErasureError } from "@/domain/erasure";
import { keepInRetention } from "@/domain/retention";
import { getRequestContext, type RequestContext } from "@/lib/context";
import { formatDateIn, SUPPRESSION_REASON_LABELS } from "@/lib/format/labels";
import { can } from "@/lib/permissions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireSteward(): Promise<RequestContext> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  if (!can(ctx.role, "compliance.manage")) redirect("/?notice=not_allowed");
  return ctx;
}

const actorOf = (ctx: RequestContext) => ({ workspaceId: ctx.workspace.id, userId: ctx.user.id });
const privacyTab = (personId: string, notice: string) => `/people/${personId}?tab=privacy&notice=${notice}`;

const consentSchema = z.object({
  channel: z.enum(CONSENT_CHANNELS),
  purpose: z.enum(CONSENT_PURPOSES),
  status: z.enum(CONSENT_STATUSES),
  jurisdiction: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable(),
  proof: z.string().trim().max(1000).nullable(),
});

export async function recordConsentAction(personId: string, formData: FormData): Promise<void> {
  const ctx = await requireSteward();
  if (!UUID_RE.test(personId)) redirect("/people");
  const text = (k: string) => (String(formData.get(k) ?? "").trim() || null);
  const parsed = consentSchema.safeParse({ channel: formData.get("channel"), purpose: formData.get("purpose"), status: formData.get("status"), jurisdiction: text("jurisdiction"), proof: text("proof") });
  if (!parsed.success) redirect(privacyTab(personId, "consent_invalid"));
  try {
    await withWorkspace(ctx.workspace.id, (tx) => recordConsent(tx, actorOf(ctx), personId, parsed.data));
  } catch (error) {
    if (error instanceof ConsentError) redirect(privacyTab(personId, "consent_invalid"));
    throw error;
  }
  redirect(privacyTab(personId, "consent_recorded"));
}

export async function setDoNotContactAction(personId: string, on: boolean): Promise<void> {
  const ctx = await requireSteward();
  if (!UUID_RE.test(personId)) redirect("/people");
  await withWorkspace(ctx.workspace.id, (tx) => setDoNotContact(tx, actorOf(ctx), personId, on));
  redirect(privacyTab(personId, on ? "dnc_set" : "dnc_cleared"));
}

/** Erasure needs the full name typed back, so it cannot happen by a stray click. */
export async function erasePersonAction(personId: string, formData: FormData): Promise<void> {
  const ctx = await requireSteward();
  if (!UUID_RE.test(personId)) redirect("/people");
  const [person] = await withWorkspace(ctx.workspace.id, (tx) => tx.select({ fullName: persons.fullName }).from(persons).where(eq(persons.id, personId)).limit(1));
  if (!person) redirect("/people");
  const typed = String(formData.get("confirm_name") ?? "").trim().replace(/\s+/g, " ");
  if (typed.toLowerCase() !== person.fullName.trim().replace(/\s+/g, " ").toLowerCase()) redirect(privacyTab(personId, "erase_confirm"));
  let pending = 0;
  try {
    pending = (await erasePerson(actorOf(ctx), personId)).crm.pending;
  } catch (error) {
    if (error instanceof ErasureError) redirect("/people");
    throw error;
  }
  redirect(`/people?notice=${pending ? "person_erased_crm_pending" : "person_erased"}`);
}

export async function keepInRetentionAction(personId: string): Promise<void> {
  const ctx = await requireSteward();
  if (!UUID_RE.test(personId)) redirect("/settings/retention");
  await withWorkspace(ctx.workspace.id, (tx) => keepInRetention(tx, actorOf(ctx), personId));
  redirect("/settings/retention?notice=retention_kept");
}

const REASONS = ["opt_out", "do_not_contact"] as const;

export async function addSuppressionAction(formData: FormData): Promise<void> {
  const ctx = await requireSteward();
  const value = String(formData.get("value") ?? "");
  const reason = z.enum(REASONS).safeParse(formData.get("reason"));
  if (!reason.success) redirect("/settings/consent?notice=suppression_invalid");
  let outcome: "added" | "already";
  try {
    outcome = await withWorkspace(ctx.workspace.id, (tx) => addManualSuppression(tx, actorOf(ctx), value, reason.data));
  } catch (error) {
    if (error instanceof ConsentError) redirect("/settings/consent?notice=suppression_invalid");
    throw error;
  }
  redirect(`/settings/consent?notice=${outcome === "added" ? "suppression_added" : "suppression_exists"}`);
}

export async function removeSuppressionAction(formData: FormData): Promise<void> {
  const ctx = await requireSteward();
  const value = String(formData.get("value") ?? "");
  let outcome: "removed" | "not_found" | "erasure";
  try {
    outcome = await withWorkspace(ctx.workspace.id, (tx) => removeManualSuppression(tx, actorOf(ctx), value));
  } catch (error) {
    if (error instanceof ConsentError) redirect("/settings/consent?notice=suppression_invalid");
    throw error;
  }
  redirect(`/settings/consent?notice=${outcome === "removed" ? "suppression_removed" : outcome === "erasure" ? "suppression_erasure" : "suppression_not_found"}`);
}

/**
 * Looks an address up without putting it in a URL. Nothing is written, so nothing is audited;
 * the answer names the reason and date only.
 */
export async function checkSuppressionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireSteward();
  const value = String(formData.get("value") ?? "");
  const found = await withWorkspace(ctx.workspace.id, (tx) => checkSuppression(tx, ctx.workspace.id, value));
  if (!found) return { message: "Enter an email address or a LinkedIn profile URL.", values: { value } };
  const what = found.kind === "email" ? "This address" : "This profile";
  if (!found.reason) return { message: `${what} is not on the suppression list.`, values: { value } };
  return { message: `${what} is suppressed: ${SUPPRESSION_REASON_LABELS[found.reason]?.toLowerCase() ?? found.reason}, since ${formatDateIn(found.since!, ctx.workspace.timezone)}.`, values: { value } };
}
