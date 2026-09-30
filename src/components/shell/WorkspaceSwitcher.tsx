"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import styles from "./WorkspaceSwitcher.module.css";

interface WorkspaceOption {
  id: string;
  name: string;
  roleLabel: string;
}

interface WorkspaceSwitcherProps {
  current: string;
  workspaces: WorkspaceOption[];
  switchAction: (formData: FormData) => Promise<void>;
  /** "bar" collapses to an icon between sm and md; "drawer" always shows the name, full width. */
  placement?: "bar" | "drawer";
}

/** Shown only to users with more than one workspace (design file section 7). */
export function WorkspaceSwitcher({ current, workspaces, switchAction, placement = "bar" }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const currentName = workspaces.find((w) => w.id === current)?.name ?? "Workspace";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`${styles.root} ${placement === "drawer" ? styles.drawer : styles.bar}`}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Workspace: ${currentName}. Switch workspace`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.name}>{currentName}</span>
        <ChevronsUpDown size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open ? (
        <div id={listId} className={styles.panel}>
          <p className={styles.label}>Workspaces</p>
          <ul className={styles.list}>
            {workspaces.map((w) => (
              <li key={w.id}>
                <form action={switchAction}>
                  <input type="hidden" name="workspaceId" value={w.id} />
                  <button type="submit" className={styles.option} aria-current={w.id === current ? "true" : undefined}>
                    <span className={styles.optionName}>{w.name}</span>
                    <span className="t-caption t-muted">{w.roleLabel}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
