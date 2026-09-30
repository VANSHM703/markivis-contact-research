"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./UserMenu.module.css";

interface UserMenuProps {
  name: string;
  email: string;
  roleLabel: string;
  workspaceName: string;
  signOutAction: () => Promise<void>;
  /** Platform admins set workspace packs (BRD 5.3). */
  packsHref?: string | null;
  /** Partners and outreach owners connect their own mailbox (BRD 5.4). */
  connectionsHref?: string | null;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function UserMenu({ name, email, roleLabel, workspaceName, signOutAction, packsHref, connectionsHref }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

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
    <div ref={rootRef} className={styles.root}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account: ${name}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {initials(name)}
        </span>
      </button>
      {open ? (
        <div id={panelId} className={styles.panel}>
          <p className={styles.name}>{name}</p>
          <p className="t-caption t-muted">{email}</p>
          <dl className={styles.facts}>
            <div>
              <dt>Workspace</dt>
              <dd>{workspaceName}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{roleLabel}</dd>
            </div>
          </dl>
          {connectionsHref ? (
            <p className={styles.signOut}>
              <Link href={connectionsHref} onClick={() => setOpen(false)}>Mailbox and calendar</Link>
            </p>
          ) : null}
          {packsHref ? (
            <p className={styles.signOut}>
              <Link href={packsHref} onClick={() => setOpen(false)}>Workspace packs</Link>
            </p>
          ) : null}
          <form action={signOutAction} className={styles.signOut}>
            <button type="submit" className="btn btn--ghost btn--compact">
              Sign out
            </button>
          </form>
          <p className={`t-caption t-muted ${styles.footer}`}>BEAM by Markivis</p>
        </div>
      ) : null}
    </div>
  );
}
