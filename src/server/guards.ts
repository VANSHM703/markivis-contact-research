import { notFound, redirect } from "next/navigation";
import { getRequestContext, type RequestContext } from "@/lib/context";
import { can, type Capability } from "@/lib/permissions";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** For pages: signed in, with the capability; otherwise the permission-denied state is rendered by the caller. */
export async function pageContext(): Promise<RequestContext> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/sign-in");
  return ctx;
}

export function allowed(ctx: RequestContext, capability: Capability): boolean {
  return can(ctx.role, capability);
}

export function requireUuid(id: string): void {
  if (!UUID_RE.test(id)) notFound();
}
