import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import styles from "./Form.module.css";

interface FieldShellProps {
  id: string;
  label: string;
  required?: boolean;
  help?: string;
  error?: string;
  children: ReactNode;
  wide?: boolean;
}

/** Label, control, helper text and error, wired for assistive technology (design file 8.3). */
export function FieldShell({ id, label, required, help, error, children, wide }: FieldShellProps) {
  return (
    <div className={wide ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required ? <span className={styles.required} aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {help ? <p id={`${id}-help`} className={styles.help}>{help}</p> : null}
      {error ? <p id={`${id}-error`} className={styles.error}>{error}</p> : null}
    </div>
  );
}

function describedBy(id: string, help?: string, error?: string) {
  return [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

type Common = { name: string; label: string; help?: string; error?: string; wide?: boolean };

export function TextField({ name, label, help, error, wide, required, id = name, ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell id={id} label={label} required={required} help={help} error={error} wide={wide}>
      <input id={id} name={name} required={required} className={styles.input} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, help, error)} {...rest} />
    </FieldShell>
  );
}

export function TextArea({ name, label, help, error, wide = true, required, id = name, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell id={id} label={label} required={required} help={help} error={error} wide={wide}>
      <textarea id={id} name={name} required={required} className={`${styles.input} ${styles.textarea}`} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, help, error)} {...rest} />
    </FieldShell>
  );
}

export function SelectField({
  name,
  label,
  help,
  error,
  wide,
  required,
  options,
  id = name,
  ...rest
}: Common & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <FieldShell id={id} label={label} required={required} help={help} error={error} wide={wide}>
      <select id={id} name={name} required={required} className={styles.input} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, help, error)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** A group of checkboxes; the whole label row is the hit area (design file 8.3). */
export function CheckboxGroup({ name, legend, options, defaultValues = [], error, help }: { name: string; legend: string; options: { value: string; label: string }[]; defaultValues?: string[]; error?: string; help?: string }) {
  return (
    <fieldset className={`${styles.field} ${styles.wide} ${styles.fieldset}`} aria-describedby={describedBy(name, help, error)}>
      <legend className={styles.label}>{legend}</legend>
      <div className={styles.checks}>
        {options.map((o) => (
          <label key={o.value} className={styles.check}>
            <input type="checkbox" name={name} value={o.value} defaultChecked={defaultValues.includes(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {help ? <p id={`${name}-help`} className={styles.help}>{help}</p> : null}
      {error ? <p id={`${name}-error`} className={styles.error}>{error}</p> : null}
    </fieldset>
  );
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className={`card ${styles.section}`}>
      <div className={styles.sectionHeader}>
        <h2 className="t-heading-card">{title}</h2>
        {description ? <p className="t-caption t-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
