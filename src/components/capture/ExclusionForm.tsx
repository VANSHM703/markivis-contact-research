"use client";

import { useActionState } from "react";
import { TextField } from "@/components/forms/Field";
import { EMPTY_FORM_STATE, type FormState } from "@/components/forms/FormState";
import { FormSummary } from "@/components/forms/FormSummary";
import { SubmitButton } from "@/components/forms/SubmitButton";
import styles from "@/components/forms/Form.module.css";

export function ExclusionForm({ action }: { action: (s: FormState, f: FormData) => Promise<FormState> }) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  return (
    <form action={formAction} className={styles.stack} noValidate>
      <FormSummary message={state.message} />
      <TextField name="pattern" label="Address or domain" required placeholder="jane@example.com or example.com" defaultValue={String(state.values?.pattern ?? "")} error={state.fieldErrors?.pattern} help="Mail and meetings with these are never captured." />
      <div className={styles.actions}>
        <SubmitButton variant="ghost">Add exclusion</SubmitButton>
      </div>
    </form>
  );
}
