import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./DataTable.module.css";

export interface Column {
  key: string;
  label: string;
  /** Numbers, dates and ages: mono, tabular, right-aligned (design file 9.2). */
  numeric?: boolean;
}

export interface TableRow {
  id: string;
  href?: string;
  cells: Record<string, ReactNode>;
}

interface DataTableProps {
  caption: string;
  columns: Column[];
  rows: TableRow[];
  pagination?: { page: number; total: number; pageSize: number; path: string; query?: string };
}

const formatter = new Intl.NumberFormat("en-US");

/** Data table (design file 9.2). The first column is the primary cell and carries the row link. */
export function DataTable({ caption, columns, rows, pagination }: DataTableProps) {
  const [primary, ...rest] = columns;
  return (
    <div className={styles.wrap}>
      <div className={styles.container}>
        <table className={styles.table}>
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={c.numeric ? styles.numeric : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.href ? styles.linked : undefined}>
                {primary ? (
                  <th scope="row" className={styles.primary}>
                    {row.href ? (
                      <Link href={row.href} className={styles.rowLink}>
                        {row.cells[primary.key]}
                      </Link>
                    ) : (
                      row.cells[primary.key]
                    )}
                  </th>
                ) : null}
                {rest.map((c) => (
                  <td key={c.key} data-label={c.label} className={c.numeric ? styles.numeric : undefined}>
                    {row.cells[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination ? <Pagination {...pagination} /> : null}
    </div>
  );
}

function Pagination({ page, total, pageSize, path, query }: { page: number; total: number; pageSize: number; path: string; query?: string }) {
  const href = (p: number) => `${path}?${query ? `${query}&` : ""}page=${p}`;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <p className="t-meta t-muted">
        Showing {formatter.format(first)} to {formatter.format(last)} of {formatter.format(total)}
      </p>
      <div className={styles.pageButtons}>
        {page > 1 ? (
          <Link className="btn btn--ghost btn--compact" href={href(page - 1)}>
            Previous
          </Link>
        ) : (
          <span className="btn btn--ghost btn--compact" aria-disabled="true">Previous</span>
        )}
        {page < pages ? (
          <Link className="btn btn--ghost btn--compact" href={href(page + 1)}>
            Next
          </Link>
        ) : (
          <span className="btn btn--ghost btn--compact" aria-disabled="true">Next</span>
        )}
      </div>
    </nav>
  );
}
