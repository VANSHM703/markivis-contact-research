"use client";

import { useEffect, useId, useRef, useState } from "react";
import { APP_BASE_PATH } from "@/config/product";
import { FieldShell } from "./Field";
import styles from "./CompanyPicker.module.css";

interface Option {
  id: string;
  name: string;
  detail: string | null;
}

interface CompanyPickerProps {
  /** Hidden inputs submitted with the form: `${name}_id` for an existing company, `${name}_new` for a new one. */
  name: string;
  label: string;
  required?: boolean;
  error?: string;
  defaultCompany?: { id: string; name: string } | null;
  /** Off for forms that must name a company already on the list, such as an off-limits rule. */
  allowNew?: boolean;
}

/** Searchable company combobox with "Add as a new company" (design file 8.3, ARIA combobox pattern). */
export function CompanyPicker({ name, label, required, error, defaultCompany, allowNew = true }: CompanyPickerProps) {
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState(defaultCompany?.name ?? "");
  const [selected, setSelected] = useState<{ id: string | null; name: string } | null>(defaultCompany ?? null);
  const [options, setOptions] = useState<Option[]>([]);
  // The query the current options answer. "Add as a new company" waits for it, so a quick Enter
  // can never create a company that already exists.
  const [answered, setAnswered] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !query.trim() || selected?.name === query) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${APP_BASE_PATH}/api/v1/companies/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) return;
        const body = (await response.json()) as { data: { id: string; name: string; domain: string | null; industry: string | null }[] };
        setOptions(body.data.map((c) => ({ id: c.id, name: c.name, detail: c.domain ?? c.industry })));
        setAnswered(query);
        setActive(-1);
      } catch {
        // Aborted or offline: keep the current options.
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, selected]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const trimmed = query.trim();
  const exact = options.some((o) => o.name.toLowerCase() === trimmed.toLowerCase());
  const items: (Option | { id: null; name: string; detail: string })[] = [
    ...options,
    ...(allowNew && trimmed && !exact && answered === query ? [{ id: null, name: trimmed, detail: "Add as a new company" }] : []),
  ];

  function choose(index: number) {
    const item = items[index];
    if (!item) return;
    setSelected({ id: item.id, name: item.name });
    setQuery(item.name);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter" && open && active >= 0) {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const status = selected ? (selected.id ? "Existing company" : "New company, created when you save") : null;

  return (
    <div ref={rootRef} className={styles.root}>
      <FieldShell id={inputId} label={label} required={required} error={error} help={status ?? "Type to search companies in this workspace."}>
        <div className={styles.control}>
        <input
            id={inputId}
            className={styles.input}
            role="combobox"
            aria-expanded={open && items.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${inputId}-help${error ? ` ${inputId}-error` : ""}`}
            autoComplete="off"
            value={query}
            required={required}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
          {open && items.length > 0 ? (
            <ul id={listId} role="listbox" className={styles.list}>
              {items.map((item, index) => (
                <li
                  key={item.id ?? "new"}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={index === active ? `${styles.option} ${styles.active}` : styles.option}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(index)}
                >
                  <span className={styles.name}>{item.id ? item.name : `Add "${item.name}"`}</span>
                  {item.detail ? <span className="t-caption t-muted">{item.detail}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </FieldShell>
      <input type="hidden" name={`${name}_id`} value={selected?.id ?? ""} />
      <input type="hidden" name={`${name}_new`} value={selected && !selected.id ? selected.name : ""} />
    </div>
  );
}
