"use client";

import { useActionState } from "react";
import type { HealthResult } from "@/ingest/types";
import styles from "./Settings.module.css";

/** "Check connection" with the result inline; the provider's message in mono below (design file 9.10). */
export function HealthCheck({ action, label }: { action: (prev: HealthResult | null) => Promise<HealthResult>; label: string }) {
  const [result, run, pending] = useActionState(action, null);
  return (
    <form action={run} className={styles.health}>
      <button type="submit" className="btn btn--ghost" aria-busy={pending || undefined} disabled={pending} aria-label={`Check connection: ${label}`}>
        Check connection
      </button>
      <div role="status" aria-live="polite">
        {result ? (
          <p className={result.ok ? styles.okText : styles.warnText}>
            {result.ok ? "✓ " : ""}
            {result.message}
            {result.detail ? <span className={`t-meta ${styles.detail}`}>{result.detail}</span> : null}
          </p>
        ) : null}
      </div>
    </form>
  );
}
