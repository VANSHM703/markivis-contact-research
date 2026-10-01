import Link from "next/link";
import { BrandLockup } from "@/components/shell/BrandLockup";
import styles from "./not-found.module.css";

/** Any address the app does not have, styled like the rest of it in light and dark. */
export default function RootNotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <BrandLockup />
        <h1 className="t-display-3">Page not found</h1>
        <p className="t-lede">There is nothing at this address.</p>
        <p>
          <Link href="/" className="btn btn--primary">Go to Today</Link>
        </p>
      </div>
    </main>
  );
}
