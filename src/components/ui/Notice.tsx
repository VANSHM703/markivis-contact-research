import styles from "./Notice.module.css";

/**
 * The confirmation after an action, shown from a ?notice= key and announced politely (design
 * file 9.9). Only known keys render, so the URL cannot inject text.
 */
const NOTICES: Record<string, { text: string; tone: "ok" | "warn" }> = {
  person_created: { text: "Person added.", tone: "ok" },
  person_created_possible_duplicate: { text: "Person added. Someone with the same name is already in the workspace, so the pair is waiting in the queue under Conflicts and duplicates.", tone: "warn" },
  person_updated: { text: "Changes saved.", tone: "ok" },
  role_added: { text: "Role added.", tone: "ok" },
  role_exists: { text: "That role was already on the record, so nothing was added.", tone: "warn" },
  role_ended: { text: "Role ended.", tone: "ok" },
  end_role_invalid: { text: "Couldn't end the role: enter the end date and how you know.", tone: "warn" },
  merged: { text: "Records merged. You can reverse this for 90 days from the merged record.", tone: "ok" },
  merge_failed: { text: "Couldn't merge: one of these records has already been merged.", tone: "warn" },
  unmerged: { text: "Merge reversed.", tone: "ok" },
  unmerge_expired: { text: "This merge can no longer be reversed. Merges can be reversed for 90 days.", tone: "warn" },
  company_created: { text: "Company added.", tone: "ok" },
  company_updated: { text: "Changes saved.", tone: "ok" },
  import_committed: { text: "Import complete.", tone: "ok" },
  import_already_done: { text: "This import has already been committed or discarded.", tone: "warn" },
  import_discarded: { text: "Import discarded. Nothing was saved.", tone: "ok" },
  conflict_resolved: { text: "Value chosen. The record now shows it.", tone: "ok" },
  duplicate_merged: { text: "Records merged.", tone: "ok" },
  kept_separate: { text: "Kept as separate people.", tone: "ok" },
  item_gone: { text: "Someone has already resolved that item.", tone: "warn" },
  not_allowed: { text: "Your role does not allow that action.", tone: "warn" },
  run_queued: { text: "Run queued. The worker picks it up within a minute; refresh to see the result.", tone: "ok" },
  queue_unavailable: { text: "Couldn't queue the run: the job database is not reachable. Check that the worker is set up.", tone: "warn" },
  source_not_runnable: { text: "That source cannot be run from here.", tone: "warn" },
  feed_enabled: { text: "Source switched on.", tone: "ok" },
  feed_disabled: { text: "Source switched off. It will not run until it is switched on again.", tone: "ok" },
  feed_added: { text: "Feed added. It runs on its schedule, or use Run now.", tone: "ok" },
  apollo_key_saved: { text: "Apollo key saved. It is stored encrypted and cannot be shown again.", tone: "ok" },
};

export function Notice({ notice }: { notice?: string | string[] }) {
  const key = Array.isArray(notice) ? notice[0] : notice;
  const entry = key ? NOTICES[key] : undefined;
  return (
    <div role="status" aria-live="polite" className={styles.region}>
      {entry ? <p className={entry.tone === "ok" ? `${styles.notice} ${styles.ok}` : `${styles.notice} ${styles.warn}`}>{entry.text}</p> : null}
    </div>
  );
}
