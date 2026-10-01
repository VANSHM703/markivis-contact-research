/**
 * CRM integration (BRD 15, P1): one adapter interface; HubSpot is the first implementation.
 * The CRM owns contacts, companies and logged activity; this tool owns signals, validation,
 * provenance, scores and connections. Nothing overwrites the other side silently.
 */
export interface CrmContactOut {
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  company: string | null;
  band: string | null;
  lastTwoWayAt: Date | null;
}

export interface CrmContactIn {
  crmId: string;
  email: string | null;
  jobTitle: string | null;
  company: string | null;
  emailOptOut: boolean;
  modifiedAt: string;
}

export interface CrmNoteOut {
  contactCrmId: string;
  at: Date;
  body: string;
}

export interface CrmAdapter {
  provider: "hubspot";
  /** Creates the custom properties this tool writes, when they are missing. */
  ensureProperties(): Promise<void>;
  /** Creates or updates contacts by email; returns the CRM id per email. */
  upsertContacts(contacts: CrmContactOut[]): Promise<Map<string, string>>;
  createNote(note: CrmNoteOut): Promise<string>;
  /** Contacts changed since a time, for sync in. */
  contactsModifiedSince(since: Date): Promise<CrmContactIn[]>;
  /** Permanently deletes a contact, for an erasure (BRD 18.2). False when the CRM no longer has it. */
  deleteContact(crmId: string): Promise<boolean>;
}
