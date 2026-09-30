import { EmptyState } from "./EmptyState";

/** Permission-denied state (design file checklist). Says who can see the screen. */
export function PermissionDenied({ who }: { who: string }) {
  return <EmptyState message={`This screen is available to ${who}. Ask your partner or data steward if you need access.`} />;
}
