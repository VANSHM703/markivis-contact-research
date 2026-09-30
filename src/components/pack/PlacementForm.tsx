"use client";

import { useActionState } from "react";
import { CompanyPicker } from "@/components/forms/CompanyPicker";
import { FormGrid, TextField } from "@/components/forms/Field";
import { EMPTY_FORM_STATE, type FormState } from "@/components/forms/FormState";
import { FormSummary } from "@/components/forms/FormSummary";
import { SubmitButton } from "@/components/forms/SubmitButton";
import styles from "@/components/forms/Form.module.css";

/** Record a placement by hand (BRD 13). */
export function PlacementForm({ action, company, title }: { action: (s: FormState, f: FormData) => Promise<FormState>; company: { id: string; name: string } | null; title: string }) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className={styles.stack} noValidate>
      <FormSummary message={state.message} />
      <FormGrid>
        <CompanyPicker name="company" label="Placed at" required error={e.company_id} defaultCompany={company} allowNew={false} />
        <TextField name="role_title" label="Role" required defaultValue={String(v.role_title ?? title)} error={e.role_title} />
        <TextField name="placed_on" label="Placement date" type="date" required defaultValue={String(v.placed_on ?? "")} error={e.placed_on} />
        <TextField name="search_reference" label="Search reference" help="Optional, for example DSP-2024-014." defaultValue={String(v.search_reference ?? "")} error={e.search_reference} />
      </FormGrid>
      <div className={styles.actions}>
        <SubmitButton>Record placement</SubmitButton>
      </div>
    </form>
  );
}
