"use client";

import { useEffect, useId, useRef } from "react";
import { Search } from "lucide-react";
import { APP_BASE_PATH } from "@/config/product";
import styles from "./GlobalSearch.module.css";

interface GlobalSearchProps {
  /** Only the top-bar instance listens for the "/" shortcut. */
  shortcut?: boolean;
  className?: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Search people and companies. "/" focuses it unless the user is already typing (BRD section 16.1). */
export function GlobalSearch({ shortcut = false, className }: GlobalSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (!shortcut) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shortcut]);

  return (
    <form role="search" action={`${APP_BASE_PATH}/people`} method="get" className={`${styles.search} ${className ?? ""}`}>
      <label htmlFor={id} className="visually-hidden">
        Search people and companies
      </label>
      <Search className={styles.icon} size={18} strokeWidth={1.75} aria-hidden="true" />
      <input
        ref={inputRef}
        id={id}
        name="q"
        type="search"
        className={styles.input}
        placeholder="Search people and companies"
        autoComplete="off"
        inputMode="search"
        enterKeyHint="search"
      />
      {shortcut ? (
        <kbd className={styles.kbd} aria-hidden="true">
          /
        </kbd>
      ) : null}
    </form>
  );
}
