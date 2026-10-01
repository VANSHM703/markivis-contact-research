"use client";

import { useActionState } from "react";
import formStyles from "@/components/forms/Form.module.css";
import { EMPTY_FORM_STATE } from "@/components/forms/FormState";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { checkSuppressionAction } from "@/server/compliance-actions";
import styles from "./Compliance.module.css";

/** Looks an address up on the suppression list. The address is posted, never put in the URL. */
export function SuppressionCheck() {
  const [state, action] = useActionState(checkSuppressionAction, EMPTY_FORM_STATE);
  return (
    <form action={action} className={formStyles.stack}>
      <div className={styles.row}>
        <label className={formStyles.field}>
          <span className={formStyles.label}>Email address or LinkedIn profile URL</span>
          <input name="value" required autoComplete="off" defaultValue={(state.values?.value as string | undefined) ?? ""} className={formStyles.input} />
        </label>
        <SubmitButton variant="ghost">Check</SubmitButton>
      </div>
      <p role="status" aria-live="polite" className={styles.result}>{state.message ?? ""}</p>
    </form>
  );
}
