import { FormGrid, FormSection, SelectField, TextArea, TextField } from "@/components/forms/Field";
import type { FormState } from "@/components/forms/FormState";
import { SOURCE_TYPES } from "@/server/forms";

/** "How do you know this?" (BRD 16.4). Required on every manual entry. */
export function SourceFields({ state, title = "How do you know this?" }: { state: FormState; title?: string }) {
  const v = (k: string) => (state.values?.[k] as string | undefined) ?? undefined;
  return (
    <FormSection title={title} description="Every manual change keeps its source, so others can check it later.">
      <FormGrid>
        <SelectField name="source_type" label="Source" required options={[...SOURCE_TYPES]} defaultValue={v("source_type") ?? "manual"} error={state.fieldErrors?.source_type} />
        <TextField name="source_url" label="Link" type="url" inputMode="url" autoComplete="url" placeholder="https://" defaultValue={v("source_url")} error={state.fieldErrors?.source_url} />
        <TextArea name="source_note" label="Note" required rows={2} placeholder="For example: announced at the company's investor day, Sep 12" defaultValue={v("source_note")} error={state.fieldErrors?.source_note} />
      </FormGrid>
    </FormSection>
  );
}
