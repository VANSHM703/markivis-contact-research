import styles from "./ReadoutBand.module.css";

export interface ReadoutFigure {
  label: string;
  value: string;
  overTarget?: boolean;
}

/** The only dark band in the app: four figures at the top of Today (design file section 9.4). */
export function ReadoutBand({ figures, label }: { figures: readonly ReadoutFigure[]; label: string }) {
  return (
    <section data-theme="dark" className={styles.band} aria-label={label}>
      <dl className={styles.grid}>
        {figures.map((figure) => (
          <div key={figure.label} className={styles.figure}>
            <dt className={styles.label}>{figure.label}</dt>
            <dd className={styles.value}>
              <span>{figure.value}</span>
              {figure.overTarget ? <span className={styles.over}>Over target</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
