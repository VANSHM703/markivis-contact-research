/** The value a server action returns to a form rendered with useActionState. */
export interface FormState {
  message?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string | string[]>;
  /** A related record to link from the message, for example the existing person on a match. */
  link?: { href: string; label: string };
}

export const EMPTY_FORM_STATE: FormState = {};
