/**
 * CRM sync (BRD 15, `crm.sync` every 15 minutes), when the workspace flag `crm.hubspot` is on and
 * a HubSpot private app token is saved (or in mock mode).
 *
 * Out: tracked people with an email, as contacts (name, title, company, relationship band, last
 *      two-way touch); interactions logged here, including messages sent from here, as notes.
 * In:  contacts changed in HubSpot since the last run and matching a tracked person by email: an
 *      email opt-out becomes an email outreach consent of opted_out; a job title that differs from
 *      ours is observed as a CRM source, so a disagreement becomes a data conflict for a validator
 *      rather than an overwrite.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { getDataMode } from "@/config/env";
import { withWorkspace, type Tx } from "@/db/client";
import { companies, consents, crmLinks, interactions, persons, relationshipScores, roles, workspaces } from "@/db/schema";
import { readWorkspaceSecret } from "@/domain/secrets";
import { observeField } from "@/domain/provenance";
import { liveHttp, mockHttp, ok, type HttpClient } from "@/ingest/http";
import { readJsonFixture } from "@/ingest/fixtures";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { createHubSpotAdapter } from "./hubspot";
import type { CrmAdapter, CrmContactOut } from "./types";

const PROVIDER = "hubspot";
const MAX_NOTES_PER_RUN = 100;

/** A mock HubSpot: accepts writes with stable ids; changes come from fixtures/crm/hubspot/contacts.json. */
export function mockHubSpotHttp(now: () => Date = () => new Date()): HttpClient {
  const id = (s: string) => `hs-${createHash("sha256").update(s).digest("hex").slice(0, 10)}`;
  return mockHttp(async (req) => {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path.startsWith("/crm/v3/properties/contacts/")) return ok(JSON.stringify({ name: path.split("/").pop() }));
    if (path === "/crm/v3/objects/contacts/batch/upsert") {
      const inputs = (req.body as { inputs: { id: string }[] }).inputs;
      return ok(JSON.stringify({ status: "COMPLETE", results: inputs.map((i) => ({ id: id(i.id), properties: { email: i.id } })) }));
    }
    if (path === "/crm/v3/objects/notes") return ok(JSON.stringify({ id: id(JSON.stringify(req.body)) }));
    if (path === "/crm/v3/objects/contacts/gdpr-delete") return { status: 204, headers: {}, text: "" };
    if (path === "/crm/v3/objects/contacts/search") {
      const file = await readJsonFixture<{ results: unknown[] }>("crm/hubspot/contacts.json", now());
      return ok(JSON.stringify(file ?? { results: [] }));
    }
    return undefined;
  });
}

interface CrmState {
  last_out_at?: string;
  last_in_at?: string;
  last_error?: string | null;
  last_result?: Record<string, number>;
}

export async function crmAdapterFor(workspaceId: string, options: { http?: HttpClient; now?: Date } = {}): Promise<CrmAdapter | null> {
  const ready = await withWorkspace(workspaceId, async (tx) => {
    const [ws] = await tx.select({ flags: workspaces.flags }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if ((ws!.flags as Record<string, boolean>)["crm.hubspot"] !== true) return null;
    if (getDataMode() === "mock") return { token: "mock" };
    const token = await readWorkspaceSecret(tx, workspaceId, "hubspot_private_app_token");
    return token ? { token } : null;
  });
  if (!ready) return null;
  const http = options.http ?? (ready.token === "mock" ? mockHubSpotHttp(() => options.now ?? new Date()) : liveHttp({ timeoutMs: 30_000 }));
  return createHubSpotAdapter(http, ready.token);
}

async function saveState(tx: Tx, workspaceId: string, patch: CrmState) {
  await tx.update(workspaces).set({ settings: sql`jsonb_set(${workspaces.settings}, '{crm}', coalesce(${workspaces.settings}->'crm', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)` }).where(eq(workspaces.id, workspaceId));
}

async function link(tx: Tx, workspaceId: string, entityType: string, entityId: string, crmId: string, now: Date) {
  await tx
    .insert(crmLinks)
    .values({ workspaceId, provider: PROVIDER, entityType, entityId, crmId, syncedAt: now })
    .onConflictDoUpdate({ target: [crmLinks.workspaceId, crmLinks.provider, crmLinks.entityType, crmLinks.entityId], set: { crmId, syncedAt: now } });
}

const splitName = (full: string) => {
  const parts = full.trim().split(/\s+/);
  return { firstName: parts.slice(0, -1).join(" ") || parts[0]!, lastName: parts.length > 1 ? parts.at(-1)! : "" };
};

export interface CrmRunResult {
  contacts: number;
  notes: number;
  optOuts: number;
  conflicts: number;
  erased: number;
}

/**
 * Carries out the delete instructions an erasure leaves (src/domain/erasure.ts): each contact of
 * an erased person is permanently deleted in the CRM, then its link goes. Runs straight after an
 * erasure and at the start of every sync, so a CRM that was unreachable is retried.
 */
export async function deleteErasedContacts(workspaceId: string, options: { http?: HttpClient; now?: Date; crm?: CrmAdapter | null } = {}): Promise<{ deleted: number; pending: number }> {
  const marked = await withWorkspace(workspaceId, (tx) => tx.select({ id: crmLinks.id, crmId: crmLinks.crmId }).from(crmLinks).where(and(eq(crmLinks.provider, PROVIDER), eq(crmLinks.entityType, "erased_person"))));
  if (marked.length === 0) return { deleted: 0, pending: 0 };
  const crm = options.crm === undefined ? await crmAdapterFor(workspaceId, options) : options.crm;
  if (!crm) return { deleted: 0, pending: marked.length };
  let deleted = 0;
  for (const link of marked) {
    try {
      await crm.deleteContact(link.crmId);
    } catch (error) {
      log.error("crm.erase_failed", { workspaceId, error: (error as Error).message.slice(0, 300) });
      break;
    }
    await withWorkspace(workspaceId, async (tx) => {
      await tx.delete(crmLinks).where(eq(crmLinks.id, link.id));
      await audit(tx, { workspaceId, actorUserId: null, actorKind: "system", action: "crm.contact_erased", entityType: "crm_link", entityId: link.id, after: { provider: PROVIDER } });
    });
    deleted++;
  }
  return { deleted, pending: marked.length - deleted };
}

export async function runCrmSync(workspaceId: string, options: { http?: HttpClient; now?: Date } = {}): Promise<CrmRunResult | { skipped: string }> {
  const now = options.now ?? new Date();
  const crm = await crmAdapterFor(workspaceId, options);
  if (!crm) return { skipped: "HubSpot is not connected for this workspace." };
  try {
    const erased = (await deleteErasedContacts(workspaceId, { crm })).deleted;
    await crm.ensureProperties();
    const state = await withWorkspace(workspaceId, async (tx) => (((await tx.select({ s: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0]!.s as { crm?: CrmState }).crm ?? {}));

    // --- Out: contacts ------------------------------------------------------------------------
    const people = await withWorkspace(workspaceId, (tx) =>
      tx
        .select({ id: persons.id, name: persons.fullName, email: roles.businessEmail, title: roles.title, company: companies.name, band: relationshipScores.band, lastTwoWayAt: relationshipScores.lastTwoWayAt })
        .from(persons)
        .innerJoin(roles, and(eq(roles.personId, persons.id), eq(roles.isPrimary, true)))
        .innerJoin(companies, eq(companies.id, roles.companyId))
        .leftJoin(relationshipScores, and(eq(relationshipScores.personId, persons.id), isNull(relationshipScores.userId)))
        .where(and(eq(persons.isTracked, true), isNull(persons.mergedIntoId), sql`${roles.businessEmail} is not null and ${roles.emailStatus} <> 'invalid'`, sql`${persons.status} <> 'do_not_contact'`)),
    );
    const out: CrmContactOut[] = people.map((p) => ({ email: p.email!, ...splitName(p.name), jobTitle: p.title, company: p.company, band: p.band, lastTwoWayAt: p.lastTwoWayAt }));
    const ids = await crm.upsertContacts(out);
    const contactOf = new Map<string, string>();
    await withWorkspace(workspaceId, async (tx) => {
      for (const p of people) {
        const crmId = ids.get(p.email!.toLowerCase());
        if (!crmId) continue;
        contactOf.set(p.id, crmId);
        await link(tx, workspaceId, "person", p.id, crmId, now);
      }
    });

    // --- Out: interactions logged here and sent messages, as notes ---------------------------
    const pending = await withWorkspace(workspaceId, async (tx) => {
      const linked = tx.select({ id: crmLinks.entityId }).from(crmLinks).where(and(eq(crmLinks.provider, PROVIDER), eq(crmLinks.entityType, "interaction")));
      return tx
        .select({ id: interactions.id, personId: interactions.personId, channel: interactions.channel, direction: interactions.direction, occurredAt: interactions.occurredAt, subject: interactions.subject, isPrivate: interactions.isPrivate })
        .from(interactions)
        .where(and(inArray(interactions.personId, Array.from(contactOf.keys()).length ? Array.from(contactOf.keys()) : ["00000000-0000-0000-0000-000000000000"]), inArray(interactions.channel, ["email", "meeting", "call", "linkedin_message"]), sql`${interactions.provider} <> 'crm'`, notInArray(interactions.id, linked)))
        .limit(MAX_NOTES_PER_RUN);
    });
    let notes = 0;
    for (const i of pending) {
      const direction = i.direction === "outbound" ? "sent" : i.direction === "inbound" ? "received" : "held";
      // Private items go to the CRM without their subject (BRD 11.3).
      const body = `${i.channel.replace("_", " ")} ${direction} (logged by BEAM Decision-Maker Intelligence)${i.subject && !i.isPrivate ? `: ${i.subject}` : ""}`;
      const noteId = await crm.createNote({ contactCrmId: contactOf.get(i.personId)!, at: i.occurredAt, body });
      await withWorkspace(workspaceId, (tx) => link(tx, workspaceId, "interaction", i.id, noteId, now));
      notes++;
    }

    // --- In: opt-outs and title changes -------------------------------------------------------
    const since = state.last_in_at ? new Date(state.last_in_at) : new Date(now.getTime() - 30 * 86_400_000);
    const changed = await crm.contactsModifiedSince(since);
    let optOuts = 0;
    let conflicts = 0;
    await withWorkspace(workspaceId, async (tx) => {
      for (const c of changed) {
        if (!c.email) continue;
        const [match] = await tx
          .select({ personId: roles.personId, roleId: roles.id, title: roles.title, isPrimary: roles.isPrimary })
          .from(roles)
          .innerJoin(persons, eq(persons.id, roles.personId))
          .where(and(eq(roles.businessEmail, c.email), eq(persons.isTracked, true), isNull(persons.mergedIntoId)))
          .orderBy(sql`${roles.isPrimary} desc`)
          .limit(1);
        if (!match) continue;
        if (c.emailOptOut) {
          const [before] = await tx.select({ status: consents.status }).from(consents).where(and(eq(consents.personId, match.personId), eq(consents.channel, "email"), eq(consents.purpose, "outreach"))).limit(1);
          if (before?.status !== "opted_out") {
            await tx
              .insert(consents)
              .values({ workspaceId, personId: match.personId, channel: "email", purpose: "outreach", status: "opted_out", capturedVia: "crm", proof: `HubSpot contact ${c.crmId}: unsubscribed from email.`, recordedAt: now })
              .onConflictDoUpdate({ target: [consents.personId, consents.channel, consents.purpose], set: { status: "opted_out", capturedVia: "crm", proof: `HubSpot contact ${c.crmId}: unsubscribed from email.`, recordedAt: now } });
            await audit(tx, { workspaceId, actorUserId: null, actorKind: "system", action: "consent.recorded", entityType: "person", entityId: match.personId, before: { status: before?.status ?? "unknown" }, after: { status: "opted_out", via: "crm" } });
            optOuts++;
          }
        }
        if (c.jobTitle && c.jobTitle.trim().toLowerCase() !== match.title.trim().toLowerCase()) {
          const result = await observeField(tx, { workspaceId, entityType: "role", entityId: match.roleId, field: "title", value: c.jobTitle.trim(), sourceType: "crm", confidence: "medium" });
          if (result.outcome === "conflict") conflicts++;
        }
      }
      await saveState(tx, workspaceId, { last_out_at: now.toISOString(), last_in_at: now.toISOString(), last_error: null, last_result: { contacts: ids.size, notes, optOuts, conflicts, erased } });
    });
    return { contacts: ids.size, notes, optOuts, conflicts, erased };
  } catch (error) {
    const message = (error as Error).message.slice(0, 300);
    await withWorkspace(workspaceId, (tx) => saveState(tx, workspaceId, { last_error: message }));
    log.error("crm.sync_failed", { workspaceId, error: message });
    return { skipped: message };
  }
}
