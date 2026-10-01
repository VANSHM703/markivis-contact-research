/**
 * HubSpot adapter (BRD 15), against the CRM v3 API with a private app token stored per workspace.
 * Checked against HubSpot's documentation on 2026-09-30:
 *   - POST /crm/v3/objects/contacts/batch/upsert with idProperty "email", at most 100 per call
 *     (scopes crm.objects.contacts.read and .write);
 *   - POST /crm/v3/objects/contacts/search for changes since a time (the search API has its own,
 *     stricter rate limit);
 *   - POST /crm/v3/objects/notes with an association to the contact (type 202, note to contact);
 *   - GET and POST /crm/v3/properties/contacts for the two custom properties written here;
 *   - POST /crm/v3/objects/contacts/gdpr-delete with the contact id, for an erasure: a permanent
 *     delete, where the plain DELETE only moves the contact to the recycling bin for 90 days.
 * Private apps get 100 requests per 10 seconds on Free and Starter (190 on Professional and
 * Enterprise), so requests are paced and a 429 stops the run for the next schedule to retry.
 */
import { assertOk, HttpError, type HttpClient } from "@/ingest/http";
import type { CrmAdapter, CrmContactIn } from "./types";

export const HUBSPOT = "https://api.hubapi.com";
export const BAND_PROPERTY = "dmi_relationship_band";
export const LAST_TOUCH_PROPERTY = "dmi_last_two_way_touch";
const BATCH = 100;

const midnightMs = (d: Date) => String(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export function createHubSpotAdapter(http: HttpClient, token: string): CrmAdapter {
  const call = async <T>(method: "GET" | "POST", path: string, body?: unknown, allow404 = false): Promise<T | null> => {
    const response = await http.request({ method, url: `${HUBSPOT}${path}`, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" }, body });
    if (allow404 && response.status === 404) return null;
    assertOk(response, "HubSpot");
    return response.text ? (JSON.parse(response.text) as T) : null;
  };

  return {
    provider: "hubspot",

    async ensureProperties() {
      const defs = [
        { name: BAND_PROPERTY, label: "Relationship band", type: "enumeration", fieldType: "select", options: ["strong", "warm", "cooling", "cold", "none"].map((v, i) => ({ label: v[0]!.toUpperCase() + v.slice(1), value: v, displayOrder: i })) },
        { name: LAST_TOUCH_PROPERTY, label: "Last two-way touch", type: "date", fieldType: "date" },
      ];
      for (const def of defs) {
        const found = await call("GET", `/crm/v3/properties/contacts/${def.name}`, undefined, true);
        if (!found) await call("POST", "/crm/v3/properties/contacts", { ...def, groupName: "contactinformation", description: "Written by BEAM Decision-Maker Intelligence." });
      }
    },

    async upsertContacts(contacts) {
      const ids = new Map<string, string>();
      for (let i = 0; i < contacts.length; i += BATCH) {
        const inputs = contacts.slice(i, i + BATCH).map((c) => ({
          id: c.email,
          idProperty: "email",
          properties: {
            email: c.email,
            firstname: c.firstName,
            lastname: c.lastName,
            ...(c.jobTitle ? { jobtitle: c.jobTitle } : {}),
            ...(c.company ? { company: c.company } : {}),
            ...(c.band ? { [BAND_PROPERTY]: c.band } : {}),
            ...(c.lastTwoWayAt ? { [LAST_TOUCH_PROPERTY]: midnightMs(c.lastTwoWayAt) } : {}),
          },
        }));
        const result = await call<{ results: { id: string; properties: { email?: string } }[] }>("POST", "/crm/v3/objects/contacts/batch/upsert", { inputs });
        for (const r of result?.results ?? []) if (r.properties.email) ids.set(r.properties.email.toLowerCase(), r.id);
      }
      return ids;
    },

    async createNote(note) {
      const result = await call<{ id: string }>("POST", "/crm/v3/objects/notes", {
        properties: { hs_timestamp: note.at.toISOString(), hs_note_body: note.body },
        associations: [{ to: { id: note.contactCrmId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }],
      });
      if (!result?.id) throw new HttpError("HubSpot did not return the note.", null);
      return result.id;
    },

    async deleteContact(crmId) {
      const response = await http.request({ method: "POST", url: `${HUBSPOT}/crm/v3/objects/contacts/gdpr-delete`, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" }, body: { objectId: crmId } });
      if (response.status === 404) return false;
      assertOk(response, "HubSpot");
      return true;
    },

    async contactsModifiedSince(since) {
      const out: CrmContactIn[] = [];
      let after: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result = await call<{ results: { id: string; properties: Record<string, string | null>; updatedAt: string }[]; paging?: { next?: { after: string } } }>("POST", "/crm/v3/objects/contacts/search", {
          filterGroups: [{ filters: [{ propertyName: "lastmodifieddate", operator: "GT", value: String(since.getTime()) }] }],
          properties: ["email", "jobtitle", "company", "hs_email_optout"],
          limit: 100,
          ...(after ? { after } : {}),
        });
        for (const r of result?.results ?? []) {
          out.push({ crmId: r.id, email: r.properties.email?.toLowerCase() ?? null, jobTitle: r.properties.jobtitle ?? null, company: r.properties.company ?? null, emailOptOut: r.properties.hs_email_optout === "true", modifiedAt: r.updatedAt });
        }
        after = result?.paging?.next?.after;
        if (!after) break;
      }
      return out;
    },
  };
}
