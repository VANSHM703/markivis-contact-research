"use client";

import { useActionState } from "react";
import { CompanyPicker } from "@/components/forms/CompanyPicker";
import { FormGrid, SelectField, TextField } from "@/components/forms/Field";
import { EMPTY_FORM_STATE, type FormState } from "@/components/forms/FormState";
import { FormSummary } from "@/components/forms/FormSummary";
import { SubmitButton } from "@/components/forms/SubmitButton";
import styles from "@/components/forms/Form.module.css";

const TYPES = [
  { value: "reported_to", label: "Reporting line" },
  { value: "introduced_by", label: "Introduced by" },
  { value: "deal_counterpart", label: "Deal counterpart" },
  { value: "manual_other", label: "Other" },
];

/** A connection added by hand on a person page (BRD 11.6). */
export function AddConnectionForm({ action }: { action: (s: FormState, f: FormData) => Promise<FormState> }) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className={styles.stack} noValidate>
      <FormSummary message={state.message} />
      <FormGrid>
        <CompanyPicker name="other" label="Who" required kind="person" error={e.other_id} />
        <SelectField name="type" label="How they know each other" required options={TYPES} defaultValue={String(state.values?.type ?? "manual_other")} error={e.type} />
        <TextField name="note" label="Note" help="Optional, for example: co-founded the company together." defaultValue={String(state.values?.note ?? "")} wide />
      </FormGrid>
      <div className={styles.actions}>
        <SubmitButton variant="ghost">Add connection</SubmitButton>
      </div>
    </form>
  );
}
