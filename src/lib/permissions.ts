/** Roles and the permission matrix, BRD sections 5.3 and 5.4. */
import type { WorkspaceRole } from "@/config/navigation";

export type Capability =
  | "records.view"
  | "mandate_notes.view"
  | "interactions.view_subject"
  | "queue.work"
  | "records.edit"
  | "persons.merge"
  | "drafts.approve"
  | "messages.send"
  | "actions.dismiss"
  | "off_limits.set"
  | "privacy.mark_private"
  | "mailbox.connect"
  | "members.manage"
  | "compliance.manage"
  | "data.export_all"
  | "audit_log.view"
  | "settings.change";

const P = "partner";
const O = "outreach_owner";
const V = "validator";
const A = "account_lead";
const D = "data_steward";

/** One row per line of the BRD 5.4 table, in the same order. */
export const PERMISSIONS: Readonly<Record<Capability, readonly WorkspaceRole[]>> = {
  "records.view": [P, O, V, A, D],
  "mandate_notes.view": [P],
  "interactions.view_subject": [P, O],
  "queue.work": [P, V],
  "records.edit": [P, O, V],
  "persons.merge": [P, V],
  "drafts.approve": [P],
  "messages.send": [P, O],
  "actions.dismiss": [P, O],
  "off_limits.set": [P],
  "privacy.mark_private": [P],
  "mailbox.connect": [P, O],
  "members.manage": [P, D],
  "compliance.manage": [D],
  "data.export_all": [D],
  "audit_log.view": [P, D],
  "settings.change": [P, D],
};

export function can(role: WorkspaceRole, capability: Capability): boolean {
  return PERMISSIONS[capability].includes(role);
}

export class ForbiddenError extends Error {
  constructor(public readonly capability: Capability) {
    super(`This role cannot ${capability}.`);
  }
}

export function assertCan(role: WorkspaceRole, capability: Capability): void {
  if (!can(role, capability)) throw new ForbiddenError(capability);
}
