"use client";

import { useActionState } from "react";
import { CheckboxGroup, FormGrid, FormSection, SelectField, TextField } from "@/components/forms/Field";
import { EMPTY_FORM_STATE, type FormState } from "@/components/forms/FormState";
import { FormSummary } from "@/components/forms/FormSummary";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { CLIENT_STATUS_OPTIONS, OWNERSHIP_OPTIONS, TIER_OPTIONS } from "@/server/forms";
import { SourceFields } from "./SourceFields";
import styles from "@/components/forms/Form.module.css";

export interface CompanyDefaults {
  name?: string;
  domain?: string | null;
  ticker?: string | null;
  sec_cik?: string | null;
  ownership?: string;
  target_tier?: string;
  industry?: string | null;
  hq_country?: string | null;
  employee_count?: string;
  client_status?: string;
  is_sponsor?: boolean;
}

export function CompanyForm({ action, defaults = {}, submitLabel }: { action: (state: FormState, formData: FormData) => Promise<FormState>; defaults?: CompanyDefaults; submitLabel: string }) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  const e = state.fieldErrors ?? {};
  const v = (k: keyof CompanyDefaults) => (state.values?.[k] as string | undefined) ?? (defaults[k] as string | undefined) ?? "";
  const sponsor = state.values ? state.values.is_sponsor === "true" : !!defaults.is_sponsor;
  return (
    <form action={formAction} className={styles.stack} noValidate>
      <FormSummary message={state.message} link={state.link} />
      <FormSection title="Company">
        <FormGrid>
          <TextField name="name" label="Name" required autoComplete="organization" defaultValue={v("name")} error={e.name} wide />
          <TextField name="domain" label="Domain" inputMode="url" placeholder="example.com" help="Used to match people by email." defaultValue={v("domain")} error={e.domain} />
          <TextField name="industry" label="Industry" defaultValue={v("industry")} error={e.industry} />
          <SelectField name="ownership" label="Ownership" options={OWNERSHIP_OPTIONS} defaultValue={v("ownership") || "unknown"} error={e.ownership} />
          <SelectField name="target_tier" label="Target tier" options={TIER_OPTIONS} defaultValue={v("target_tier")} error={e.target_tier} />
          <SelectField name="client_status" label="Client status" options={CLIENT_STATUS_OPTIONS} defaultValue={v("client_status") || "prospect"} error={e.client_status} />
          <TextField name="hq_country" label="Headquarters country" maxLength={2} placeholder="US" defaultValue={v("hq_country")} error={e.hq_country} />
          <TextField name="employee_count" label="Employees" inputMode="numeric" defaultValue={v("employee_count")} error={e.employee_count} />
          <TextField name="ticker" label="Ticker" help="Public companies only." defaultValue={v("ticker")} error={e.ticker} />
          <TextField name="sec_cik" label="SEC CIK" inputMode="numeric" help="Lets the platform watch this company's SEC filings." defaultValue={v("sec_cik")} error={e.sec_cik} />
          <CheckboxGroup name="is_sponsor" legend="Private equity" options={[{ value: "on", label: "This is a PE sponsor" }]} defaultValues={sponsor ? ["on"] : []} />
        </FormGrid>
      </FormSection>
      <SourceFields state={state} />
      <div className={styles.actions}>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
