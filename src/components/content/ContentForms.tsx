"use client";

import { useActionState } from "react";
import formStyles from "@/components/forms/Form.module.css";
import { EMPTY_FORM_STATE } from "@/components/forms/FormState";
import { FormSummary } from "@/components/forms/FormSummary";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { addContentAction, uploadContentImportAction } from "@/server/content-actions";

/** Adds one content item; topics come from the workspace vocabulary. */
export function AddContentForm({ topics }: { topics: string[] }) {
  const [state, action] = useActionState(addContentAction, EMPTY_FORM_STATE);
  const v = state.values ?? {};
  const chosen = new Set((v.topics as string[] | undefined) ?? []);
  return (
    <form action={action} className={formStyles.stack}>
      <FormSummary message={state.message} />
      <div className={formStyles.grid}>
        <label className={`${formStyles.field} ${formStyles.wide}`}>
          <span className={formStyles.label}>Title</span>
          <input name="title" required maxLength={200} defaultValue={(v.title as string) ?? ""} className={formStyles.input} />
        </label>
        <label className={formStyles.field}>
          <span className={formStyles.label}>Web address</span>
          <input type="url" name="url" placeholder="https://" defaultValue={(v.url as string) ?? ""} className={formStyles.input} />
        </label>
        <label className={formStyles.field}>
          <span className={formStyles.label}>Published</span>
          <input type="date" name="published_on" defaultValue={(v.published_on as string) ?? ""} className={formStyles.input} />
        </label>
        <fieldset className={`${formStyles.fieldset} ${formStyles.field} ${formStyles.wide}`}>
          <legend className={formStyles.label}>Topics</legend>
          <div className={formStyles.checks}>
            {topics.map((t) => (
              <label key={t} className={formStyles.check}>
                <input type="checkbox" name="topics" value={t} defaultChecked={chosen.has(t)} />
                {t}
              </label>
            ))}
          </div>
        </fieldset>
        <label className={`${formStyles.field} ${formStyles.wide}`}>
          <span className={formStyles.label}>Description</span>
          <textarea name="description" rows={2} maxLength={500} defaultValue={(v.description as string) ?? ""} className={`${formStyles.input} ${formStyles.textarea}`} />
        </label>
      </div>
      <div className={formStyles.actions}>
        <SubmitButton>Add to the library</SubmitButton>
      </div>
    </form>
  );
}

export function ContentImportForm() {
  const [state, action] = useActionState(uploadContentImportAction, EMPTY_FORM_STATE);
  const error = state.fieldErrors?.file;
  return (
    <form action={action} className={formStyles.stack} noValidate>
      <FormSummary message={state.message} />
      <label className={formStyles.field}>
        <span className={formStyles.label}>Content library CSV</span>
        <input id="content-file" name="file" type="file" accept=".csv,text/csv" required className={formStyles.input} aria-invalid={error ? true : undefined} aria-describedby={error ? "content-file-help content-file-error" : "content-file-help"} />
        <span id="content-file-help" className={formStyles.help}>Columns: title, url, topics (separated by semicolons), published_on, description. Nothing is saved until you review the preview.</span>
        {error ? <span id="content-file-error" className={formStyles.error}>{error}</span> : null}
      </label>
      <div className={formStyles.actions}>
        <SubmitButton arrow>Preview import</SubmitButton>
      </div>
    </form>
  );
}
