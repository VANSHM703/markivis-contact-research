import Link from "next/link";
import styles from "./Form.module.css";

/** The form-level error, announced when it appears. */
export function FormSummary({ message, link }: { message?: string; link?: { href: string; label: string } }) {
  if (!message) return null;
  return (
    <p role="alert" className={styles.summary}>
      {message}
      {link ? (
        <>
          {" "}
          <Link href={link.href}>{link.label}</Link>
        </>
      ) : null}
    </p>
  );
}
