/** Warm paths (BRD 11.7, design file 9.12): the route in words, type, strength, owner, explanation. */
import { SubmitButton } from "@/components/forms/SubmitButton";
import { Chip } from "@/components/ui/Chip";
import { CONNECTION_LABELS } from "@/domain/connections";
import type { WarmPath } from "@/domain/paths";
import { draftIntroductionAction } from "@/server/relationship-actions";
import styles from "./Relationships.module.css";

export function PathList({ paths, targetId, targetName, canDraft, empty }: { paths: WarmPath[]; targetId: string; targetName: string; canDraft: boolean; empty: string }) {
  if (paths.length === 0) return <p className="t-caption t-muted">{empty}</p>;
  return (
    <ol className={styles.paths}>
      {paths.map((p) => (
        <li key={`${p.kind}-${p.connector_person_id ?? "direct"}`} className={styles.path}>
          <p className={styles.route}>
            You<span className={styles.arrow}>→</span>
            {p.kind === "one_hop" ? (
              <>
                {p.connector_name}
                <span className={styles.arrow}>→</span>
              </>
            ) : null}
            {targetName}
          </p>
          <div className={styles.meta}>
            <Chip>{p.kind === "direct" ? "Direct" : (CONNECTION_LABELS[p.connection_type ?? ""] ?? "Connection")}</Chip>
            <span className={styles.strength}>
              <span className={styles.track} role="img" aria-label={`Strength ${p.strength.toFixed(2)}`}>
                <span className={styles.bar} style={{ width: `${Math.round(p.strength * 100)}%`, display: "block" }} />
              </span>
              <span className="t-meta">{p.strength.toFixed(2)}</span>
            </span>
            {p.owner_name ? <span className="t-caption t-muted">Owner: {p.owner_name}</span> : null}
          </div>
          <p className="t-caption">{p.explanation}</p>
          {p.kind === "one_hop" && canDraft && p.connector_person_id ? (
            <form action={draftIntroductionAction.bind(null, targetId, p.connector_person_id)}>
              <SubmitButton variant="ghost" compact arrow>Draft introduction request</SubmitButton>
            </form>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
