/**
 * Delegated OAuth for capture (BRD 11.1, 11.2): the authorization URL (with PKCE and a state
 * value), the code exchange, and token refresh. This is separate from sign-in, which asks for no
 * mailbox access. Tokens are stored with envelope encryption (lib/crypto) and never leave the
 * server; revoking deletes them.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { APP_BASE_PATH } from "@/config/product";
import { assertOk, type HttpClient } from "@/ingest/http";
import { GOOGLE_SCOPES } from "./google";
import { MICROSOFT_SCOPES, MICROSOFT_SEND_SCOPE } from "./microsoft";
import type { CaptureProviderName } from "./types";

type Env = Record<string, string | undefined>;

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: readonly string[];
}

export class OAuthNotConfiguredError extends Error {}

export function redirectUri(provider: CaptureProviderName, env: Env = process.env): string {
  return `${(env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${APP_BASE_PATH}/api/v1/connections/${provider}/callback`;
}

export function oauthConfig(provider: CaptureProviderName, env: Env = process.env, options: { send?: boolean } = {}): OAuthConfig {
  if (provider === "microsoft") {
    const clientId = env.AUTH_MICROSOFT_CLIENT_ID;
    const clientSecret = env.AUTH_MICROSOFT_CLIENT_SECRET;
    const tenant = env.AUTH_MICROSOFT_TENANT || "organizations";
    if (!clientId || !clientSecret) throw new OAuthNotConfiguredError("Microsoft 365 is not set up: set AUTH_MICROSOFT_CLIENT_ID, AUTH_MICROSOFT_CLIENT_SECRET and AUTH_MICROSOFT_TENANT.");
    return {
      clientId,
      clientSecret,
      authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      // Sending (BRD 12.5) is a separate permission, asked for only when the user turns it on.
      scopes: options.send ? [...MICROSOFT_SCOPES, MICROSOFT_SEND_SCOPE] : MICROSOFT_SCOPES,
    };
  }
  const clientId = env.AUTH_GOOGLE_CLIENT_ID;
  const clientSecret = env.AUTH_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new OAuthNotConfiguredError("Google is not set up: set AUTH_GOOGLE_CLIENT_ID and AUTH_GOOGLE_CLIENT_SECRET.");
  return { clientId, clientSecret, authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", scopes: GOOGLE_SCOPES };
}

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export function authorizationUrl(provider: CaptureProviderName, config: OAuthConfig, state: string, challenge: string, env: Env = process.env): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: redirectUri(provider, env),
    scope: config.scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  // Google returns a refresh token only for offline access with consent.
  if (provider === "google") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  } else params.set("prompt", "select_account");
  return `${config.authorizeUrl}?${params.toString()}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string[];
}

async function tokenRequest(http: HttpClient, config: OAuthConfig, body: Record<string, string>): Promise<TokenSet> {
  const response = await http.request({
    method: "POST",
    url: config.tokenUrl,
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...body }).toString(),
  });
  assertOk(response, "The sign-in service");
  const json = JSON.parse(response.text) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
  return { accessToken: json.access_token, refreshToken: json.refresh_token ?? null, expiresAt: Date.now() + json.expires_in * 1000, scopes: (json.scope ?? config.scopes.join(" ")).split(/\s+/).filter(Boolean) };
}

export function exchangeCode(http: HttpClient, provider: CaptureProviderName, config: OAuthConfig, code: string, verifier: string, env: Env = process.env): Promise<TokenSet> {
  return tokenRequest(http, config, { grant_type: "authorization_code", code, redirect_uri: redirectUri(provider, env), code_verifier: verifier });
}

export async function refreshTokens(http: HttpClient, config: OAuthConfig, current: TokenSet): Promise<TokenSet> {
  if (!current.refreshToken) throw new Error("The connection has no refresh token. Connect it again.");
  const next = await tokenRequest(http, config, { grant_type: "refresh_token", refresh_token: current.refreshToken });
  // Providers may not send a new refresh token; keep the old one then.
  return { ...next, refreshToken: next.refreshToken ?? current.refreshToken };
}

// ---------------------------------------------------------------------------------------------
// The state cookie: signed, short-lived, and bound to the user and workspace that started it.
// ---------------------------------------------------------------------------------------------

export interface OAuthState {
  state: string;
  verifier: string;
  userId: string;
  workspaceId: string;
  provider: CaptureProviderName;
  expiresAt: number;
}

const secret = (env: Env) => {
  const s = env.AUTH_SECRET;
  if (!s) throw new OAuthNotConfiguredError("Set AUTH_SECRET.");
  return s;
};

export function signState(value: OAuthState, env: Env = process.env): string {
  const body = b64url(Buffer.from(JSON.stringify(value)));
  return `${body}.${b64url(createHmac("sha256", secret(env)).update(body).digest())}`;
}

export function verifyState(cookie: string | undefined, returnedState: string | null, env: Env = process.env, now = Date.now()): OAuthState | null {
  if (!cookie || !returnedState) return null;
  const [body, mac] = cookie.split(".");
  if (!body || !mac) return null;
  const expected = b64url(createHmac("sha256", secret(env)).update(body).digest());
  if (expected.length !== mac.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  const value = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as OAuthState;
  if (value.state !== returnedState || value.expiresAt < now) return null;
  return value;
}

export function newState(provider: CaptureProviderName, userId: string, workspaceId: string, now = Date.now()): { value: OAuthState; challenge: string } {
  const { verifier, challenge } = pkcePair();
  return { value: { state: b64url(randomBytes(16)), verifier, userId, workspaceId, provider, expiresAt: now + 10 * 60_000 }, challenge };
}
