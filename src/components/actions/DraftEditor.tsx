"use client";

import { useState } from "react";
import styles from "./Actions.module.css";

interface DraftEditorProps {
  formId: string;
  action: (formData: FormData) => void | Promise<void>;
  back: string;
  channel: "email" | "linkedin_message";
  subject: string | null;
  body: string;
  rationale: string | null;
  wordLimit: number;
  issues: string[];
  readOnly: boolean;
}

const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/**
 * The draft editor (design file 9.6): subject and body at 16 px, a word count against the style
 * guide limit, the AI's rationale above, and for LinkedIn a one-click copy (BRD 12.5). The decision
 * bar's buttons submit this form through their `form` attribute, so what is approved or sent is
 * exactly what is on screen.
 */
export function DraftEditor({ formId, action, back, channel, subject, body, rationale, wordLimit, issues, readOnly }: DraftEditorProps) {
  const [text, setText] = useState(body);
  const [copied, setCopied] = useState("");
  const words = countWords(text);
  const over = words > wordLimit;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Message copied. Paste it into LinkedIn, then mark it sent.");
    } catch {
      setCopied("Couldn't copy automatically. Select the message and copy it.");
    }
  }

  return (
    <form id={formId} action={action} className={styles.editor}>
      <input type="hidden" name="back" value={back} />
      {rationale ? <p className="t-caption t-muted">Why this angle: {rationale}</p> : null}
      {issues.length ? (
        <div className={styles.warn} role="note">
          <p>This draft mentions facts that are not on record. Edit or redraft it before approving:</p>
          <ul>{issues.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
      ) : null}
      {channel === "email" ? (
        <label className={styles.field}>
          <span className={styles.label}>Subject</span>
          <input name="subject" defaultValue={subject ?? ""} className={styles.input} readOnly={readOnly} maxLength={200} />
        </label>
      ) : null}
      <label className={styles.field}>
        <span className={styles.label}>{channel === "email" ? "Email" : "LinkedIn message"}</span>
        <textarea name="body" value={text} onChange={(e) => setText(e.target.value)} className={styles.textarea} rows={channel === "email" ? 11 : 7} readOnly={readOnly} />
      </label>
      <div className={styles.editorFoot}>
        <span className={`t-meta ${over ? styles.over : "t-muted"}`}>
          {words} of {wordLimit} words{over ? ", over the style guide limit" : ""}
        </span>
        {channel === "linkedin_message" ? (
          <button type="button" className="btn btn--ghost btn--compact" onClick={copy}>
            Copy message
          </button>
        ) : null}
      </div>
      <p className="t-caption" role="status" aria-live="polite">{copied}</p>
    </form>
  );
}
