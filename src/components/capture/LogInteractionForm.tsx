"use client";

import { useActionState } from "react";
import { FormGrid, SelectField, TextArea, TextField } from "@/components/forms/Field";
import { EMPTY_FORM_STATE, type FormState } from "@/components/forms/FormState";
import { FormSummary } from "@/components/forms/FormSummary";
import { SubmitButton } from "@/components/forms/SubmitButton";
import styles from "@/components/forms/Form.module.css";

const CHANNELS = [
  { value: "meeting", label: "Meeting" },
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "linkedin_message", label: "LinkedIn message" },
  { value: "event", label: "Event" },
  { value: "interview", label: "Interview" },
  { value: "note", label: "Note" },
];
const DIRECTIONS = [
  { value: "two_way", label: "Both ways" },
  { value: "outbound", label: "We reached out" },
  { value: "inbound", label: "They reached out" },
  { value: "not_applicable", label: "Not applicable" },
];

/** Log interaction (BRD 16.4): four fields visible, the rest under More. */
export function LogInteractionForm({ action, now, canPrivate }: { action: (s: FormState, f: FormData) => Promise<FormState>; now: string; canPrivate: boolean }) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className={styles.stack} noValidate>
      <FormSummary message={state.message} />
      <FormGrid>
        <SelectField name="channel" label="How" required options={CHANNELS} defaultValue={String(v.channel ?? "meeting")} error={e.channel} />
        <TextField name="occurred_at" label="When" type="datetime-local" required defaultValue={String(v.occurred_at ?? now)} error={e.occurred_at} />
        <SelectField name="direction" label="Direction" required options={DIRECTIONS} defaultValue={String(v.direction ?? "two_way")} error={e.direction} />
        <TextArea name="summary" label="Summary" help="What was discussed, in a line or two." defaultValue={String(v.summary ?? "")} error={e.summary} />
      </FormGrid>
      <details>
        <summary className="t-caption">More</summary>
        <FormGrid>
          <TextField name="subject" label="Subject or title" defaultValue={String(v.subject ?? "")} error={e.subject} />
          {canPrivate ? (
            <label className={styles.check}>
              <input type="checkbox" name="is_private" defaultChecked={v.is_private === "on"} />
              Private: only partners see the subject and summary
            </label>
          ) : null}
        </FormGrid>
      </details>
      <div className={styles.actions}>
        <SubmitButton>Log interaction</SubmitButton>
      </div>
    </form>
  );
}
