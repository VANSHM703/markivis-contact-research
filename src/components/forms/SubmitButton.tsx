"use client";

import { useFormStatus } from "react-dom";

/** Keeps its label and width while submitting, and sets aria-busy (design file 8.1). */
export function SubmitButton({ children, variant = "primary", arrow = false, name, value }: { children: string; variant?: "primary" | "ghost" | "danger"; arrow?: boolean; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} className={`btn btn--${variant}`} aria-busy={pending || undefined} disabled={pending}>
      {children}
      {arrow ? <span className="arrow" aria-hidden="true">{pending ? "…" : "→"}</span> : null}
    </button>
  );
}
