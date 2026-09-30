import Link from "next/link";
import styles from "./FilterBar.module.css";

export interface FilterSelect {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  /** Label of the empty option, which means the screen's default. */
  anyLabel?: string;
}

interface FilterBarProps {
  path: string;
  /** Placeholder for the search box; pass null for a screen with no text search. */
  searchLabel: string | null;
  values: Record<string, string | undefined>;
  selects: FilterSelect[];
}

/** Filters as a GET form, so every view is a URL that can be bookmarked and shared (BRD 16.3). */
export function FilterBar({ path, searchLabel, values, selects }: FilterBarProps) {
  const active = Object.entries(values).filter(([, v]) => v);
  return (
    <form method="get" action={path} className={styles.bar} role="search" aria-label={searchLabel ?? "Filters"}>
      <div className={searchLabel ? styles.fields : `${styles.fields} ${styles.noSearch}`}>
        {searchLabel ? (
          <label className={styles.field}>
            <span className={styles.label}>Search</span>
            <input type="search" name="q" defaultValue={values.q ?? ""} placeholder={searchLabel} className={styles.input} autoComplete="off" />
          </label>
        ) : null}
        {selects.map((s) => (
          <label key={s.name} className={styles.field}>
            <span className={styles.label}>{s.label}</span>
            <select name={s.name} defaultValue={values[s.name] ?? ""} className={styles.input}>
              <option value="">{s.anyLabel ?? "Any"}</option>
              {s.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className={styles.actions}>
        <button type="submit" className="btn btn--ghost btn--compact">Apply filters</button>
        {active.length > 0 ? (
          <Link href={path} className={styles.clear}>
            Clear all
          </Link>
        ) : null}
      </div>
    </form>
  );
}
