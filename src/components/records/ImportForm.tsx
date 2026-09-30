"use client";

import { useActionState } from "react";
import { FieldShell, FormGrid, FormSection } from "@/components/forms/Field";
import { EMPTY_FORM_STATE, type FormState } from "@/components/forms/FormState";
import { FormSummary } from "@/components/forms/FormSummary";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { SourceFields } from "./SourceFields";
import styles from "@/components/forms/Form.module.css";

export function ImportForm({
  action,
  fileLabel = "Target list",
  fileHelp = "One row per person, or per company with no person.",
  sourceTitle = "Where did this list come from?",
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  fileLabel?: string;
  fileHelp?: string;
  sourceTitle?: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  const error = state.fieldErrors?.file;
  return (
    <form action={formAction} className={styles.stack} noValidate>
      <FormSummary message={state.message} />
      <FormSection title="File" description="CSV, up to 5 MB and 20,000 rows. Nothing is saved until you review the preview and confirm.">
        <FormGrid>
          <FieldShell id="file" label={fileLabel} required error={error} help={fileHelp} wide>
            <input id="file" name="file" type="file" accept=".csv,text/csv" required className={styles.input} aria-invalid={error ? true : undefined} aria-describedby={error ? "file-help file-error" : "file-help"} />
          </FieldShell>
        </FormGrid>
      </FormSection>
      <SourceFields state={state} title={sourceTitle} />
      <div className={styles.actions}>
        <SubmitButton arrow>Preview import</SubmitButton>
      </div>
    </form>
  );
}
