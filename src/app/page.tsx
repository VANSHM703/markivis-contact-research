import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReadoutBand } from "@/components/ui/ReadoutBand";
import styles from "./page.module.css";

export default function TodayPage() {
  return (
    <>
      <PageHeader title="Today" lede="What needs you today, in order." />
      <div className={styles.stack}>
        <ReadoutBand
          label="Today at a glance"
          figures={[
            { label: "Actions due today", value: "0" },
            { label: "Drafts awaiting approval", value: "0" },
            { label: "Items in the queue", value: "0" },
            { label: "Oldest item, working days", value: "0" },
          ]}
        />
        <EmptyState message="Nothing needs you today. New changes appear here as they are confirmed." />
      </div>
    </>
  );
}
