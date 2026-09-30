"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import styles from "./Actions.module.css";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Visible, and not inside a closed <details> (other than its own summary). */
function isTabbable(node: HTMLElement): boolean {
  const closed = node.closest("details:not([open])");
  if (closed && !(node.tagName === "SUMMARY" && node.parentElement === closed)) return false;
  return typeof node.checkVisibility === "function" ? node.checkVisibility() : node.offsetParent !== null;
}

/**
 * The action drawer (design file 9.6): right side, full screen below md. It traps focus, closes on
 * Escape or the backdrop, and returns focus to the row that opened it. The open action is in the
 * URL (?id=), so the drawer survives a form post and can be shared.
 */
export function ActionDrawer({ actionId, closeHref, titleId, children }: { actionId: string; closeHref: string; titleId: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const close = useCallback(() => {
    router.push(closeHref, { scroll: false });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-action-row="${actionId}"]`)?.focus());
  }, [router, closeHref, actionId]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.contains(document.activeElement)) el.querySelector<HTMLElement>("[data-drawer-title]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // An open popover inside the drawer closes first.
        const open = (event.target as HTMLElement | null)?.closest("details[open]");
        if (open && el.contains(open)) {
          open.removeAttribute("open");
          open.querySelector("summary")?.focus();
        } else close();
        event.preventDefault();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isTabbable);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
        last.focus();
        event.preventDefault();
      } else if (!event.shiftKey && document.activeElement === last) {
        first.focus();
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [actionId, close]);

  return (
    <div className={styles.overlay}>
      <div className={styles.backdrop} onClick={close} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={styles.drawer}>
        <button type="button" className={styles.close} onClick={close}>
          Close<span className="visually-hidden"> the action</span>
        </button>
        {children}
      </div>
    </div>
  );
}
