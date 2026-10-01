import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { getRequestContext, getSignedInUser } from "@/lib/context";
import { getTodayFigures } from "@/server/today";

export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect((await getSignedInUser())?.isPlatformAdmin ? "/platform" : "/sign-in");
  const figures = await getTodayFigures(ctx.workspace.id, ctx.user.id, new Date(), ctx.workspace.timezone);
  const actionsCount = figures.actionsDueToday + figures.actionsOverdue;
  return (
    <AppShell
      ctx={ctx}
      counts={{
        "/actions": actionsCount > 0 ? { value: actionsCount, overdue: figures.actionsOverdue > 0 } : undefined,
        "/queue": figures.queueItems > 0 ? { value: figures.queueItems } : undefined,
      }}
    >
      {children}
    </AppShell>
  );
}
