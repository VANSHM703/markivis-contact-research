import type { WorkspaceRole } from "@/config/navigation";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  workspaceName: string;
}

/**
 * Placeholder session for milestone M0. M1 replaces this with real authentication
 * (BEAM auth when available, otherwise the fallback in BRD section 5.2).
 */
export async function getSessionUser(): Promise<SessionUser> {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Jordan Example",
    email: "jordan@demo-search.example.com",
    role: "partner",
    workspaceName: "Demo Search Partners",
  };
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  partner: "Partner",
  outreach_owner: "Outreach owner",
  validator: "Validator",
  account_lead: "Account lead",
  data_steward: "Data steward",
};
