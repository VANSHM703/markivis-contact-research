"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import type { NavItem } from "@/config/navigation";
import { GlobalSearch } from "./GlobalSearch";
import { SidebarNav, type NavCounts } from "./SidebarNav";
import styles from "./MobileNav.module.css";

interface MobileNavProps {
  items: readonly NavItem[];
  counts?: NavCounts;
  /** Controls that move from the top bar into the drawer below the sm breakpoint. */
  extra?: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Below the lg breakpoint the sidebar becomes a burger and a left drawer (design file section 7). */
export function MobileNav({ items, counts, extra }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [lastPathname, setLastPathname] = useState(pathname);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close the drawer when the route changes.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (open) setOpen(false);
  }

  const close = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    drawer?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className={styles.toggle}
        aria-label="Open navigation"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen(true)}
      >
        <Menu size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>

      {open ? (
        <div className={styles.layer}>
          <div className={styles.scrim} onClick={close} aria-hidden="true" />
          <div
            ref={drawerRef}
            id="mobile-nav"
            className={styles.drawer}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className={styles.header}>
              <button type="button" className={styles.toggle} aria-label="Close navigation" onClick={close}>
                <X size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <GlobalSearch className={styles.search} />
            {extra ? <div className={styles.extra}>{extra}</div> : null}
            <nav aria-label="Primary" className={styles.nav}>
              <SidebarNav items={items} counts={counts} onNavigate={() => setOpen(false)} />
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
