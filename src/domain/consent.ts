/**
 * Consent, do not contact and the suppression list, as the data steward manages them (BRD 6.6,
 * 18.1). Do not contact and the suppression list override every other rule; the checks before
 * drafting and sending read both (src/domain/checks.ts).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { actions, consents, persons, roles, suppressions } from "@/db/schema";
import { audit } from "@/lib/audit";
import { canonicalLinkedinUrl, normaliseEmail } from "@/lib/normalise";
import { OPEN_STATUSES } from "./actions";
import { refreshPersonStatus, type Actor } from "./records";
import { addSuppression, suppressionHash, workspaceSalt } from "./suppression";

export const CONSENT_CHANNELS = ["email", "newsletter", "linkedin", "phone"] as const;
export const CONSENT_PURPOSES = ["outreach", "newsletter"] as const;
export const CONSENT_STATUSES = ["opted_in", "opted_out", "legitimate_interest", "unknown"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export class ConsentError extends Error {}

export interface ConsentInput {
  channel: ConsentChannel;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  jurisdiction: string | null;
  proof: string | null;
}

/** Records consent for one channel and purpose, with where it came from (BRD 6.6). */
export async function recordConsent(tx: Tx, actor: Actor, personId: string, input: ConsentInput, now = new Date()): Promise<void> {
  const [person] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.id, personId)).limit(1);
  if (!person) throw new ConsentError("Person not found.");
  if (input.status === "opted_in" && !input.proof) throw new ConsentError("Say how the opt-in was given, for example the form and date.");
  const [before] = await tx.select({ status: consents.status }).from(consents).where(and(eq(consents.personId, personId), eq(consents.channel, input.channel), eq(consents.purpose, input.purpose))).limit(1);
  const values = { status: input.status, jurisdiction: input.jurisdiction, proof: input.proof, capturedVia: "data_steward", recordedAt: now, recordedBy: actor.userId };
  await tx
    .insert(consents)
    .values({ workspaceId: actor.workspaceId, personId, channel: input.channel, purpose: input.purpose, ...values })
    .onConflictDoUpdate({ target: [consents.personId, consents.channel, consents.purpose], set: values });
  await audit(tx, {
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    actorKind: actor.kind ?? "user",
    action: "consent.recorded",
    entityType: "person",
    entityId: personId,
    before: { channel: input.channel, purpose: input.purpose, status: before?.status ?? "unknown" },
    after: { channel: input.channel, purpose: input.purpose, status: input.status, jurisdiction: input.jurisdiction, via: "data_steward" },
  });
}

async function identifiers(tx: Tx, personId: string): Promise<{ emails: string[]; linkedinUrl: string | null }> {
  const [person] = await tx.select({ linkedinUrl: persons.linkedinUrl }).from(persons).where(eq(persons.id, personId)).limit(1);
  const rows = await tx.select({ email: roles.businessEmail }).from(roles).where(eq(roles.personId, personId));
  return { emails: Array.from(new Set(rows.map((r) => r.email).filter((e): e is string => !!e))), linkedinUrl: person?.linkedinUrl ?? null };
}

/**
 * Sets or clears the global do-not-contact status (BRD 18.1). Setting it also puts every known
 * address on the suppression list and closes the person's open actions; clearing it takes off
 * only the entries it added, never an opt-out or an erasure.
 */
export async function setDoNotContact(tx: Tx, actor: Actor, personId: string, on: boolean, now = new Date()): Promise<{ dismissed: number }> {
  const [person] = await tx.select({ id: persons.id, status: persons.status }).from(persons).where(eq(persons.id, personId)).limit(1);
  if (!person) throw new ConsentError("Person not found.");
  if ((person.status === "do_not_contact") === on) return { dismissed: 0 };
  const ids = await identifiers(tx, personId);
  let dismissed = 0;

  if (on) {
    await tx.update(persons).set({ status: "do_not_contact" }).where(eq(persons.id, personId));
    for (const email of ids.emails) await addSuppression(tx, actor.workspaceId, "email", email, "do_not_contact");
    if (ids.linkedinUrl) await addSuppression(tx, actor.workspaceId, "linkedin", ids.linkedinUrl, "do_not_contact");
    const open = await tx.update(actions).set({ status: "dismissed", dismissReason: "do_not_contact" }).where(and(eq(actions.personId, personId), inArray(actions.status, [...OPEN_STATUSES]))).returning({ id: actions.id, status: actions.status });
    for (const a of open) {
      await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: actor.kind ?? "user", action: "action.dismissed", entityType: "action", entityId: a.id, after: { reason: "do_not_contact" } });
    }
    dismissed = open.length;
  } else {
    await tx.update(persons).set({ status: "active" }).where(eq(persons.id, personId));
    await refreshPersonStatus(tx, personId, now.toISOString().slice(0, 10));
    const salt = await workspaceSalt(tx, actor.workspaceId);
    const hashes = [...ids.emails.map((e) => suppressionHash(salt, "email", e)), ids.linkedinUrl ? suppressionHash(salt, "linkedin", ids.linkedinUrl) : null].filter((h): h is string => !!h);
    if (hashes.length) await tx.delete(suppressions).where(and(inArray(suppressions.hash, hashes), eq(suppressions.reason, "do_not_contact")));
  }
  await audit(tx, {
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    actorKind: actor.kind ?? "user",
    action: on ? "person.do_not_contact_set" : "person.do_not_contact_cleared",
    entityType: "person",
    entityId: personId,
    before: { status: person.status },
    after: { do_not_contact: on, actions_dismissed: dismissed },
  });
  return { dismissed };
}

// ---------------------------------------------------------------------------------------------
// The suppression list
// ---------------------------------------------------------------------------------------------

export type SuppressionReason = "erasure" | "opt_out" | "do_not_contact";

export async function suppressionCounts(tx: Tx): Promise<Record<SuppressionReason, number>> {
  const rows = await tx.select({ reason: suppressions.reason, n: sql<number>`count(*)::int` }).from(suppressions).groupBy(suppressions.reason);
  const out: Record<SuppressionReason, number> = { erasure: 0, opt_out: 0, do_not_contact: 0 };
  for (const r of rows) out[r.reason] = r.n;
  return out;
}

/** An email address or a LinkedIn profile URL, as the list stores it. */
export function parseIdentifier(value: string): { kind: "email" | "linkedin"; value: string } | null {
  const trimmed = value.trim();
  if (trimmed.includes("@")) {
    const email = normaliseEmail(trimmed);
    return email ? { kind: "email", value: email } : null;
  }
  const url = canonicalLinkedinUrl(trimmed);
  return url && /linkedin\.com\/in\//i.test(url) ? { kind: "linkedin", value: url } : null;
}

/** Looks an address up. The list holds only hashes, so this is the only way to read it. */
export async function checkSuppression(tx: Tx, workspaceId: string, value: string): Promise<{ kind: "email" | "linkedin"; reason: SuppressionReason | null; since: Date | null } | null> {
  const id = parseIdentifier(value);
  if (!id) return null;
  const hash = suppressionHash(await workspaceSalt(tx, workspaceId), id.kind, id.value)!;
  const [row] = await tx.select({ reason: suppressions.reason, since: suppressions.createdAt }).from(suppressions).where(and(eq(suppressions.kind, id.kind), eq(suppressions.hash, hash))).limit(1);
  return { kind: id.kind, reason: row?.reason ?? null, since: row?.since ?? null };
}

/** Adds an address by hand, for an opt-out or do-not-contact request that came in elsewhere. */
export async function addManualSuppression(tx: Tx, actor: Actor, value: string, reason: "opt_out" | "do_not_contact"): Promise<"added" | "already"> {
  const id = parseIdentifier(value);
  if (!id) throw new ConsentError("Enter an email address or a LinkedIn profile URL.");
  const existing = await checkSuppression(tx, actor.workspaceId, id.value);
  if (existing?.reason) return "already";
  await addSuppression(tx, actor.workspaceId, id.kind, id.value, reason);
  // The address itself is personal data, and the list keeps only its hash; so does this entry.
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: actor.kind ?? "user", action: "suppression.added", entityType: "suppression", after: { kind: id.kind, reason } });
  return "added";
}

/** Takes an opt-out or do-not-contact entry off the list. Erasure entries stay for good. */
export async function removeManualSuppression(tx: Tx, actor: Actor, value: string): Promise<"removed" | "not_found" | "erasure"> {
  const id = parseIdentifier(value);
  if (!id) throw new ConsentError("Enter an email address or a LinkedIn profile URL.");
  const hash = suppressionHash(await workspaceSalt(tx, actor.workspaceId), id.kind, id.value)!;
  const [row] = await tx.select({ id: suppressions.id, reason: suppressions.reason }).from(suppressions).where(and(eq(suppressions.kind, id.kind), eq(suppressions.hash, hash))).limit(1);
  if (!row) return "not_found";
  if (row.reason === "erasure") return "erasure";
  await tx.delete(suppressions).where(eq(suppressions.id, row.id));
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: actor.kind ?? "user", action: "suppression.removed", entityType: "suppression", entityId: row.id, before: { kind: id.kind, reason: row.reason } });
  return "removed";
}
