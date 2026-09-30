import { BEAM_HOME_URL, PRODUCT_NAME } from "@/config/product";
import styles from "./BrandLockup.module.css";

/** BEAM mark, word and product sub-label (BEAM_DESIGN_LANGUAGE.md section 3.1). */
export function BrandLockup() {
  return (
    // A plain anchor, not next/link: the BEAM home sits outside APP_BASE_PATH.
    <a className={styles.brand} href={BEAM_HOME_URL} aria-label="BEAM by Markivis home">
      <span className={styles.mark} aria-hidden="true">
        <b>B</b>
      </span>
      <span className={styles.word}>BEAM</span>
      <span className={styles.sub}>{PRODUCT_NAME}</span>
    </a>
  );
}
