"use client";

import { useActionState } from "react";
import { FormGrid, FormSection, SelectField, TextField } from "@/components/forms/Field";
import { CompanyPicker } from "@/components/forms/CompanyPicker";
import { EMPTY_FORM_STATE, type FormState } from "@/components/forms/FormState";
import { FormSummary } from "@/components/forms/FormSummary";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { SEAT_TYPE_OPTIONS } from "@/server/forms";
import { SourceFields } from "./SourceFields";
import styles from "@/components/forms/Form.module.css";

export function RoleForm({ action }: { action: (state: FormState, formData: FormData) => Promise<FormState> }) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  const e = state.fieldErrors ?? {};
  const v = (k: string) => (state.values?.[k] as string | undefined) ?? "";
  return (
    <form action={formAction} className={styles.stack} noValidate>
      <FormSummary message={state.message} link={state.link} />
      <FormSection title="Role" description="Add a past role by filling in the end date.">
        <FormGrid>
          <CompanyPicker name="company" label="Company" required error={e.company ?? e.company_id} />
          <TextField name="title" label="Title" required placeholder="Independent Director" defaultValue={v("title")} error={e.title} />
          <SelectField name="seat_type" label="Seat" options={SEAT_TYPE_OPTIONS} defaultValue={v("seat_type")} error={e.seat_type} />
          <TextField name="business_email" label="Business email" type="email" inputMode="email" autoComplete="email" defaultValue={v("business_email")} error={e.business_email} />
          <TextField name="effective_on" label="Start date" type="date" defaultValue={v("effective_on")} error={e.effective_on} />
          <TextField name="ended_on" label="End date" type="date" help="Leave blank for a current role." defaultValue={v("ended_on")} error={e.ended_on} />
        </FormGrid>
      </FormSection>
      <SourceFields state={state} />
      <div className={styles.actions}>
        <SubmitButton>Add role</SubmitButton>
      </div>
    </form>
  );
}
