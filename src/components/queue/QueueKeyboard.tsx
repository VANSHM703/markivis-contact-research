"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./Queue.module.css";

interface QueueKeyboardProps {
  prevHref: string | null;
  nextHref: string | null;
  canResearch: boolean;
}

const SHORTCUTS: [string, string][] = [
  ["C", "Confirm change"],
  ["R", "Reject (then 1 to 5 for the reason)"],
  ["M", "More research"],
  ["P", "Park"],
  ["J", "Next item"],
  ["K", "Previous item"],
  ["E", "Edit before confirming"],
];

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/**
 * Queue shortcuts (BRD 10.2): c confirm, r reject, m more research, p park, j and k to move, e edit.
 * They never fire while a field has focus. Forms are found by id so each works without script.
 */
export function QueueKeyboard({ prevHref, nextHref, canResearch }: QueueKeyboardProps) {
  const router = useRouter();
  const [help, setHelp] = useState(false);

  useEffect(() => {
    function submit(id: string) {
      (document.getElementById(id) as HTMLFormElement | null)?.requestSubmit();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      const menu = document.getElementById("reject-menu") as HTMLDetailsElement | null;
      if (menu?.open && /^[1-5]$/.test(event.key)) {
        event.preventDefault();
        (menu.querySelectorAll<HTMLButtonElement>("button[name=reason]")[Number(event.key) - 1])?.click();
        return;
      }
      switch (event.key.toLowerCase()) {
        case "c":
          event.preventDefault();
          submit("confirm-form");
          break;
        case "r":
          if (!menu) return;
          event.preventDefault();
          menu.open = true;
          menu.querySelector<HTMLButtonElement>("button[name=reason]")?.focus();
          break;
        case "m":
          if (!canResearch) return;
          event.preventDefault();
          submit("research-form");
          break;
        case "p":
          event.preventDefault();
          submit("park-form");
          break;
        case "j":
          if (nextHref) router.push(nextHref);
          break;
        case "k":
          if (prevHref) router.push(prevHref);
          break;
        case "e": {
          const edit = document.getElementById("edit-panel") as HTMLDetailsElement | null;
          if (!edit) return;
          event.preventDefault();
          edit.open = !edit.open;
          if (edit.open) edit.querySelector<HTMLInputElement>("input")?.focus();
          break;
        }
        case "?":
          setHelp((v) => !v);
          break;
        case "escape":
          setHelp(false);
          if (menu) menu.open = false;
          break;
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router, prevHref, nextHref, canResearch]);

  return (
    <div className={styles.help}>
      <button type="button" className="btn btn--ghost btn--compact" aria-expanded={help} aria-controls="shortcut-help" onClick={() => setHelp((v) => !v)}>
        Keyboard shortcuts
      </button>
      {help ? (
        <div id="shortcut-help" className={styles.helpPanel} role="dialog" aria-label="Keyboard shortcuts">
          <dl>
            {SHORTCUTS.map(([key, label]) => (
              <div key={key}>
                <dt>
                  <kbd className={styles.key}>{key}</kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
          <p className="t-caption t-muted">Shortcuts are off while you are typing in a field.</p>
        </div>
      ) : null}
    </div>
  );
}
