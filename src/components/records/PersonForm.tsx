"use client";

import { useActionState } from "react";
import { CheckboxGroup, FormGrid, FormSection, SelectField, TextField } from "@/components/forms/Field";
import { CompanyPicker } from "@/components/forms/CompanyPicker";
import { EMPTY_FORM_STATE, type FormState } from "@/components/forms/FormState";
import { FormSummary } from "@/components/forms/FormSummary";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { CONTACT_TYPE_OPTIONS, SEAT_TYPE_OPTIONS } from "@/server/forms";
import { SourceFields } from "./SourceFields";
import styles from "@/components/forms/Form.module.css";

export interface PersonDefaults {
  full_name?: string;
  preferred_name?: string | null;
  linkedin_url?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  contact_types?: string[];
  is_priority?: boolean;
}

interface PersonFormProps {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults?: PersonDefaults;
  /** New people are added with their first role. */
  withRole?: boolean;
  defaultCompany?: { id: string; name: string } | null;
  submitLabel: string;
  /** Contact types are part of the executive search pack (BRD 13). */
  showContactTypes?: boolean;
}

export function PersonForm({ action, defaults = {}, withRole = false, defaultCompany, submitLabel, showContactTypes = true }: PersonFormProps) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  const v = (k: keyof PersonDefaults) => (state.values?.[k] as string | undefined) ?? (defaults[k] as string | undefined) ?? "";
  const e = state.fieldErrors ?? {};
  const types = (state.values?.contact_types as string[] | undefined) ?? defaults.contact_types ?? [];
  const priority = state.values ? state.values.is_priority === "true" : !!defaults.is_priority;

  return (
    <form action={formAction} className={styles.stack} noValidate>
      <FormSummary message={state.message} link={state.link} />
      <FormSection title="Person">
        <FormGrid>
          <TextField name="full_name" label="Full name" required autoComplete="name" defaultValue={v("full_name")} error={e.full_name} />
          <TextField name="preferred_name" label="Preferred name" autoComplete="nickname" defaultValue={v("preferred_name")} error={e.preferred_name} />
          <TextField
            name="linkedin_url"
            label="LinkedIn profile"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://www.linkedin.com/in/"
            help="Entered by hand. The platform never reads LinkedIn."
            defaultValue={v("linkedin_url")}
            error={e.linkedin_url}
            wide
          />
          <TextField name="city" label="City" autoComplete="address-level2" defaultValue={v("city")} error={e.city} />
          <TextField name="country" label="Country" autoComplete="country" placeholder="US" maxLength={2} help="Two-letter code. Decides which consent rules apply." defaultValue={v("country")} error={e.country} />
          {showContactTypes ? <CheckboxGroup name="contact_types" legend="Contact type" options={CONTACT_TYPE_OPTIONS} defaultValues={types} error={e.contact_types} /> : null}
          <CheckboxGroup name="is_priority" legend="Priority" options={[{ value: "on", label: "Tier 1 target: watch for going quiet" }]} defaultValues={priority ? ["on"] : []} />
        </FormGrid>
      </FormSection>

      {withRole ? (
        <FormSection title="Current role">
          <FormGrid>
            <CompanyPicker name="company" label="Company" required error={e.company ?? e.company_id} defaultCompany={defaultCompany} />
            <TextField name="title" label="Title" required placeholder="Chief Financial Officer" defaultValue={(state.values?.title as string) ?? ""} error={e.title} />
            <SelectField name="seat_type" label="Seat" options={SEAT_TYPE_OPTIONS} defaultValue={(state.values?.seat_type as string) ?? ""} error={e.seat_type} />
            <TextField name="business_email" label="Business email" type="email" inputMode="email" autoComplete="email" defaultValue={(state.values?.business_email as string) ?? ""} error={e.business_email} />
            <TextField name="effective_on" label="Start date" type="date" defaultValue={(state.values?.effective_on as string) ?? ""} error={e.effective_on} />
            <input type="hidden" name="ended_on" value="" />
          </FormGrid>
        </FormSection>
      ) : null}

      <SourceFields state={state} />
      <div className={styles.actions}>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
