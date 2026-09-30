import { NextResponse } from "next/server";
import { getRequestContext, type RequestContext } from "@/lib/context";
import { can, type Capability } from "@/lib/permissions";

export function jsonError(status: 401 | 403 | 404 | 400, message: string) {
  return NextResponse.json({ error: message }, { status });
}

type Handler<P> = (ctx: RequestContext, request: Request, params: P) => Promise<Response>;

/**
 * Wraps an API route: requires a signed-in user with a workspace, checks the capability, and
 * passes the context on. Handlers scope every query with withWorkspace(ctx.workspace.id, ...).
 */
export function apiRoute<P = Record<string, string>>(capability: Capability, handler: Handler<P>) {
  return async (request: Request, segment: { params: Promise<P> }): Promise<Response> => {
    const ctx = await getRequestContext();
    if (!ctx) return jsonError(401, "Sign in to continue.");
    if (!can(ctx.role, capability)) return jsonError(403, "Your role does not allow this.");
    return handler(ctx, request, await segment.params);
  };
}
