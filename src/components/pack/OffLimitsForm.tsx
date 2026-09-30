"use client";

import { useActionState, useState } from "react";
import { CompanyPicker } from "@/components/forms/CompanyPicker";
import { FormGrid, SelectField, TextField } from "@/components/forms/Field";
import { EMPTY_FORM_STATE, type FormState } from "@/components/forms/FormState";
import { FormSummary } from "@/components/forms/FormSummary";
import { SubmitButton } from "@/components/forms/SubmitButton";
import styles from "@/components/forms/Form.module.css";

const SCOPES = [
  { value: "company", label: "Whole company" },
  { value: "function", label: "One function" },
  { value: "level_and_above", label: "Seniority and above" },
];
const REASONS = [
  { value: "current_client", label: "Current client" },
  { value: "recent_placement", label: "Recent placement" },
  { value: "contractual", label: "Contractual" },
];
const SENIORITIES = [
  { value: "vp", label: "VP and above" },
  { value: "svp", label: "SVP and above" },
  { value: "c_suite", label: "C-suite only" },
];

/** Add an off-limits rule (BRD 13): company, scope, reason and dates. */
export function OffLimitsForm({ action, today, company }: { action: (s: FormState, f: FormData) => Promise<FormState>; today: string; company: { id: string; name: string } | null }) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  const v = state.values ?? {};
  const [scope, setScope] = useState(String(v.scope ?? "company"));
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className={styles.stack} noValidate>
      <FormSummary message={state.message} />
      <FormGrid>
        <CompanyPicker name="company" label="Company" required error={e.company_id} defaultCompany={company} allowNew={false} />
        <SelectField name="scope" label="Covers" required options={SCOPES} value={scope} onChange={(ev) => setScope(ev.target.value)} error={e.scope} />
        {scope === "function" ? <TextField name="function" label="Function" required defaultValue={String(v.function ?? "")} placeholder="For example Finance" error={e.function} /> : null}
        {scope === "level_and_above" ? <SelectField name="min_seniority" label="Lowest seniority covered" required options={SENIORITIES} defaultValue={String(v.min_seniority ?? "vp")} error={e.min_seniority} /> : null}
        <SelectField name="reason" label="Reason" required options={REASONS} defaultValue={String(v.reason ?? "current_client")} error={e.reason} />
        <TextField name="starts_on" label="Starts" type="date" required defaultValue={String(v.starts_on ?? today)} error={e.starts_on} />
        <TextField name="ends_on" label="Ends" type="date" help="Leave blank for no end date." defaultValue={String(v.ends_on ?? "")} error={e.ends_on} />
      </FormGrid>
      <div className={styles.actions}>
        <SubmitButton>Add rule</SubmitButton>
      </div>
    </form>
  );
}
