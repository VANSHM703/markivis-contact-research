import { describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@/config/navigation";
import { can, PERMISSIONS, type Capability } from "@/lib/permissions";

// BRD 5.4, transcribed row by row: partner, outreach_owner, validator, account_lead, data_steward.
const MATRIX: [Capability, string][] = [
  ["records.view", "YYYYY"],
  ["mandate_notes.view", "YNNNN"],
  ["interactions.view_subject", "YYNNN"],
  ["queue.work", "YNYNN"],
  ["records.edit", "YYYNN"],
  ["persons.merge", "YNYNN"],
  ["drafts.approve", "YNNNN"],
  ["messages.send", "YYNNN"],
  ["actions.dismiss", "YYNNN"],
  ["off_limits.set", "YNNNN"],
  ["privacy.mark_private", "YNNNN"],
  ["mailbox.connect", "YYNNN"],
  ["members.manage", "YNNNY"],
  ["compliance.manage", "NNNNY"],
  ["data.export_all", "NNNNY"],
  ["audit_log.view", "YNNNY"],
  ["settings.change", "YNNNY"],
  // BRD 12.2 step 3, not a 5.4 row.
  ["consent.record_basis", "YNNNY"],
];
const ROLES: WorkspaceRole[] = ["partner", "outreach_owner", "validator", "account_lead", "data_steward"];

describe("permission matrix", () => {
  it("covers every capability", () => {
    expect(MATRIX.map(([c]) => c).sort()).toEqual(Object.keys(PERMISSIONS).sort());
  });

  for (const [capability, row] of MATRIX) {
    it(`matches BRD 5.4 for ${capability}`, () => {
      expect(ROLES.map((r) => (can(r, capability) ? "Y" : "N")).join("")).toBe(row);
    });
  }
});
