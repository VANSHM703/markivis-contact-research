import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

/** A record or page that does not exist here, inside the app shell. Another workspace's records land here too. */
export default function NotFound() {
  return (
    <>
      <PageHeader title="Not found" lede="This page does not exist, or it belongs to another workspace." />
      <EmptyState
        message="Check the address, or start again from Today."
        actions={
          <>
            <Link href="/" className="btn btn--primary">Today</Link>
            <Link href="/people" className="btn btn--ghost">People</Link>
          </>
        }
      />
    </>
  );
}
