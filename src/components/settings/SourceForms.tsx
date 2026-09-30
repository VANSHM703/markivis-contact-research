"use client";

import { useActionState } from "react";
import { FieldShell, FormGrid, SelectField, TextArea, TextField } from "@/components/forms/Field";
import { EMPTY_FORM_STATE, type FormState } from "@/components/forms/FormState";
import { FormSummary } from "@/components/forms/FormSummary";
import { SubmitButton } from "@/components/forms/SubmitButton";
import type { UploadResult } from "@/server/source-actions";
import formStyles from "@/components/forms/Form.module.css";
import styles from "./Settings.module.css";

type Action<S> = (state: S, formData: FormData) => Promise<S>;

export function ApolloKeyForm({ action, saved }: { action: Action<FormState>; saved: string | null }) {
  const [state, run] = useActionState(action, EMPTY_FORM_STATE);
  return (
    <form action={run} className={styles.stack} noValidate>
      <FormSummary message={state.message} />
      <p className="t-caption t-muted">{saved ? `A key is saved (${saved}). Saving a new one replaces it. Saved keys are never shown.` : "No key saved. Mock mode works without one."}</p>
      <FormGrid>
        <TextField name="apollo_api_key" label="Apollo API key" type="password" autoComplete="off" spellCheck={false} required error={state.fieldErrors?.apollo_api_key} wide />
      </FormGrid>
      <div className={formStyles.actions}>
        <SubmitButton variant="ghost">Save key</SubmitButton>
      </div>
    </form>
  );
}

export function AddFeedForm({ action }: { action: Action<FormState> }) {
  const [state, run] = useActionState(action, EMPTY_FORM_STATE);
  const v = (k: string) => (state.values?.[k] as string | undefined) ?? "";
  const e = state.fieldErrors ?? {};
  return (
    <form action={run} className={styles.stack} noValidate>
      <FormSummary message={state.message} />
      <FormGrid>
        <SelectField name="source_type" label="Type" required defaultValue={v("source_type") || "google_alert"} options={[{ value: "google_alert", label: "Google Alerts" }, { value: "press_wire", label: "Press release wire" }]} error={e.source_type} />
        <TextField name="name" label="Name" required placeholder="Alerts: tier 1 executives" defaultValue={v("name")} error={e.name} />
        <TextArea name="urls" label="Feed addresses" required rows={3} placeholder="https://www.google.com/alerts/feeds/..." help="One per line. For Google Alerts, set delivery to RSS feed and copy the feed's address." defaultValue={v("urls")} error={e.urls} />
        <TextField name="keywords" label="Keywords" placeholder="appointed, named, joins" help="Optional, separated by commas. An item must contain one." defaultValue={v("keywords")} error={e.keywords} />
        <TextField name="terms_url" label="Terms page" type="url" placeholder="https://" help="Required for wires: the feed's terms of use." defaultValue={v("terms_url")} error={e.terms_url} />
      </FormGrid>
      <div className={formStyles.actions}>
        <SubmitButton variant="ghost">Add feed</SubmitButton>
      </div>
    </form>
  );
}

export function NewsletterUploadForm({ action }: { action: Action<UploadResult> }) {
  const [state, run] = useActionState(action, EMPTY_FORM_STATE as UploadResult);
  const error = state.fieldErrors?.file;
  return (
    <form action={run} className={styles.stack} noValidate>
      <FormSummary message={state.message} />
      {state.report ? (
        <p role="status" className={styles.okText}>
          ✓ {state.report.events} events read: {state.report.created} new, {state.report.duplicates} already imported
          {state.report.suppressed ? `, ${state.report.suppressed} skipped as suppressed` : ""}
          {state.report.rejected ? `, ${state.report.rejected} rows rejected` : ""}.
        </p>
      ) : null}
      <FormGrid>
        <FieldShell id="newsletter-file" label="Events file" required error={error} help="CSV with email, event, occurred_at, issue_title, link_url, topics. Applied immediately." wide>
          <input id="newsletter-file" name="file" type="file" accept=".csv,text/csv" required className={formStyles.input} aria-invalid={error ? true : undefined} aria-describedby={error ? "newsletter-file-help newsletter-file-error" : "newsletter-file-help"} />
        </FieldShell>
      </FormGrid>
      <div className={formStyles.actions}>
        <SubmitButton variant="ghost">Upload events</SubmitButton>
      </div>
    </form>
  );
}
