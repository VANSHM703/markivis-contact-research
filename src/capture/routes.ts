/**
 * OAuth start and callback for mailbox connections (BRD 11.1, 11.2), shared by the per-provider
 * route files under /api/v1/connections/<provider>/. State and the PKCE verifier travel in a signed,
 * short-lived cookie bound to the user and workspace. In mock mode there is nothing to authorize:
 * Settings connects a demo mailbox directly.
 */
import { NextResponse } from "next/server";
import { getDataMode } from "@/config/env";
import { APP_BASE_PATH } from "@/config/product";
import { withWorkspace } from "@/db/client";
import { liveHttp } from "@/ingest/http";
import { getRequestContext } from "@/lib/context";
import { log } from "@/lib/log";
import { can } from "@/lib/permissions";
import { saveConnection } from "./connections";
import { createGoogleProvider } from "./google";
import { createMicrosoftProvider } from "./microsoft";
import { authorizationUrl, exchangeCode, newState, OAuthNotConfiguredError, oauthConfig, signState, verifyState } from "./oauth";
import type { CaptureProviderName } from "./types";

const COOKIE = "dmi.oauth";
const PAGE = "/settings/connections";

function back(request: Request, notice: string): NextResponse {
  return NextResponse.redirect(new URL(`${APP_BASE_PATH}${PAGE}?notice=${notice}`, process.env.APP_URL ?? request.url));
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

function enabled(flags: Record<string, boolean>, provider: CaptureProviderName) {
  return provider === "google" ? flags["capture.google"] === true : flags["capture.microsoft"] !== false;
}

export function startRoute(provider: CaptureProviderName) {
  return async (request: Request): Promise<Response> => {
    const ctx = await getRequestContext();
    if (!ctx) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    if (!can(ctx.role, "mailbox.connect")) return NextResponse.json({ error: "Your role does not allow this." }, { status: 403 });
    if (!enabled(ctx.workspace.flags, provider)) return back(request, "capture_off");
    if (getDataMode() === "mock") return back(request, "connect_mock");
    let config;
    try {
      config = oauthConfig(provider, process.env, { send: new URL(request.url).searchParams.get("send") === "1" });
    } catch (error) {
      if (error instanceof OAuthNotConfiguredError) return back(request, "connect_not_configured");
      throw error;
    }
    const { value, challenge } = newState(provider, ctx.user.id, ctx.workspace.id);
    const response = NextResponse.redirect(authorizationUrl(provider, config, value.state, challenge));
    response.cookies.set(COOKIE, signState(value), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: APP_BASE_PATH, maxAge: 600 });
    return response;
  };
}

export function callbackRoute(provider: CaptureProviderName) {
  return async (request: Request): Promise<Response> => {
    const ctx = await getRequestContext();
    if (!ctx) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    if (!can(ctx.role, "mailbox.connect")) return NextResponse.json({ error: "Your role does not allow this." }, { status: 403 });
    const url = new URL(request.url);
    const state = verifyState(readCookie(request, COOKIE), url.searchParams.get("state"));
    const done = (notice: string) => {
      const response = back(request, notice);
      response.cookies.set(COOKIE, "", { path: APP_BASE_PATH, maxAge: 0 });
      return response;
    };
    if (url.searchParams.get("error")) return done("connect_declined");
    const code = url.searchParams.get("code");
    if (!state || !code || state.provider !== provider || state.userId !== ctx.user.id || state.workspaceId !== ctx.workspace.id) return done("connect_failed");
    try {
      const http = liveHttp({ timeoutMs: 20_000 });
      const config = oauthConfig(provider);
      const tokens = await exchangeCode(http, provider, config, code, state.verifier);
      const client = provider === "microsoft" ? createMicrosoftProvider(http, async () => tokens.accessToken) : createGoogleProvider(http, async () => tokens.accessToken);
      const accountEmail = await client.accountEmail();
      await withWorkspace(ctx.workspace.id, (tx) => saveConnection(tx, { workspaceId: ctx.workspace.id, userId: ctx.user.id, provider, accountEmail, tokens }));
    } catch (error) {
      log.error("connection.callback_failed", { provider, error: (error as Error).message });
      return done("connect_failed");
    }
    return done("connected");
  };
}
