import { describe, expect, it } from "vitest";
import { isExcluded, matchMessage, type AddressIndex } from "@/capture/capture";
import { createGoogleProvider, parseAddresses, toGmailMessage } from "@/capture/google";
import { createMicrosoftProvider, GRAPH, MICROSOFT_SCOPES, toMessage } from "@/capture/microsoft";
import { authorizationUrl, oauthConfig, pkcePair, redirectUri, refreshTokens, signState, verifyState } from "@/capture/oauth";
import { canSeeDetail } from "@/capture/privacy";
import { mockHttp, ok, type HttpRequest } from "@/ingest/http";

const index: AddressIndex = { byEmail: new Map([["jane@client.example.com", { personId: "p-jane", roleId: "r-jane" }], ["old@former.example.com", { personId: "p-old", roleId: "r-old" }]]) };
const ours = new Set(["partner@firm.example.com"]);
const message = (over: Partial<Parameters<typeof matchMessage>[0]> = {}) => ({ id: "1", internetMessageId: "<1@x>", conversationId: "c1", sentAt: "2026-09-29T10:00:00Z", from: "partner@firm.example.com", to: [], cc: [], subject: "Hello", ...over });

describe("matching captured mail to tracked people (BRD 11.1)", () => {
  it("creates nothing for a message with no tracked person", () => {
    expect(matchMessage(message({ to: ["friend@family.example.net"] }), index, ours, [])).toEqual([]);
  });
  it("finds tracked people in from, to and cc, and sets the direction from the sender", () => {
    expect(matchMessage(message({ to: ["jane@client.example.com"] }), index, ours, [])).toEqual([{ personId: "p-jane", roleId: "r-jane", direction: "outbound" }]);
    expect(matchMessage(message({ from: "office@law.example.net", to: ["partner@firm.example.com"], cc: ["old@former.example.com"] }), index, ours, [])).toEqual([{ personId: "p-old", roleId: "r-old", direction: "inbound" }]);
  });
  it("skips excluded addresses and domains", () => {
    expect(matchMessage(message({ to: ["jane@client.example.com"] }), index, ours, ["client.example.com"])).toEqual([]);
    expect(isExcluded("a@sub.family.example.net", ["@family.example.net"])).toBe(true);
    expect(isExcluded("a@family.example.net", ["b@family.example.net"])).toBe(false);
    expect(isExcluded("a@notfamily.example.net", ["family.example.net"])).toBe(false);
  });
});

describe("privacy (BRD 11.3, 5.4, scenario 12)", () => {
  it("shows subjects of private items to the partner only", () => {
    expect(canSeeDetail("partner", true)).toBe(true);
    expect(canSeeDetail("outreach_owner", true)).toBe(false);
    expect(canSeeDetail("outreach_owner", false)).toBe(true);
    expect(canSeeDetail("validator", false)).toBe(false);
  });
});

describe("Microsoft Graph provider", () => {
  it("asks for the least-privileged scopes, never a body permission", () => {
    expect([...MICROSOFT_SCOPES]).toEqual(["offline_access", "User.Read", "Mail.ReadBasic", "Calendars.ReadBasic"]);
    expect(oauthConfig("microsoft", { AUTH_MICROSOFT_CLIENT_ID: "id", AUTH_MICROSOFT_CLIENT_SECRET: "s", AUTH_MICROSOFT_TENANT: "t" }, { send: true }).scopes).toContain("Mail.Send");
  });
  it("follows next links per folder, keeps each delta link as the cursor, and drops removed items", async () => {
    const seen: string[] = [];
    const http = mockHttp((req: HttpRequest) => {
      seen.push(req.url);
      expect(req.headers?.authorization).toBe("Bearer token");
      if (req.url.includes("/mailFolders/inbox/messages/delta?$select")) {
        return ok(JSON.stringify({ value: [{ id: "a", internetMessageId: "<a@x>", conversationId: "c", sentDateTime: "2026-09-29T10:00:00Z", from: { emailAddress: { address: "Jane@Client.example.com" } }, toRecipients: [{ emailAddress: { address: "partner@firm.example.com" } }], subject: "Hi" }], "@odata.nextLink": `${GRAPH}/next-inbox` }));
      }
      if (req.url.endsWith("/next-inbox")) return ok(JSON.stringify({ value: [{ id: "gone", "@removed": { reason: "deleted" } }], "@odata.deltaLink": `${GRAPH}/delta-inbox` }));
      if (req.url.includes("/mailFolders/sentitems/")) return ok(JSON.stringify({ value: [], "@odata.deltaLink": `${GRAPH}/delta-sent` }));
      return undefined;
    });
    const delta = await createMicrosoftProvider(http, async () => "token").mailDelta(null, new Date("2025-09-30T00:00:00Z"));
    expect(delta.messages).toHaveLength(1);
    expect(delta.messages[0]).toMatchObject({ from: "jane@client.example.com", to: ["partner@firm.example.com"], conversationId: "c" });
    expect(JSON.parse(delta.cursor)).toEqual({ inbox: `${GRAPH}/delta-inbox`, sentitems: `${GRAPH}/delta-sent` });
    expect(seen[0]).toContain("$filter=receivedDateTime+ge+2025-09-30");
    expect(seen[0]).not.toMatch(/body/);
    expect(toMessage({ id: "x" })).toBeNull();
  });
});

describe("Google provider (P1)", () => {
  it("parses metadata headers into addresses", () => {
    expect(parseAddresses('"Example, Jane" <Jane@Example.com>, ops@example.org')).toEqual(["jane@example.com", "ops@example.org"]);
    const m = toGmailMessage({ id: "g1", threadId: "t1", internalDate: String(Date.parse("2026-09-29T10:00:00Z")), payload: { headers: [{ name: "From", value: "Jane <jane@example.com>" }, { name: "To", value: "me@firm.example.com" }, { name: "Subject", value: "Hi" }, { name: "Message-ID", value: "<g1@mail>" }] } });
    expect(m).toMatchObject({ internetMessageId: "<g1@mail>", conversationId: "t1", from: "jane@example.com", to: ["me@firm.example.com"], subject: "Hi" });
  });
  it("syncs from the saved history id and keeps the new one", async () => {
    const http = mockHttp((req) => {
      if (req.url.endsWith("/profile")) return ok(JSON.stringify({ emailAddress: "me@firm.example.com", historyId: "200" }));
      if (req.url.includes("/history?startHistoryId=100")) return ok(JSON.stringify({ history: [{ messagesAdded: [{ message: { id: "g1" } }] }] }));
      if (req.url.includes("/messages/g1?format=metadata")) return ok(JSON.stringify({ id: "g1", threadId: "t1", internalDate: String(Date.parse("2026-09-29T10:00:00Z")), payload: { headers: [] } }));
      return undefined;
    });
    const delta = await createGoogleProvider(http, async () => "t").mailDelta(JSON.stringify({ historyId: "100" }), new Date("2025-01-01T00:00:00Z"));
    expect(delta.messages.map((m) => m.id)).toEqual(["g1"]);
    expect(JSON.parse(delta.cursor)).toEqual({ historyId: "200" });
  });
});

describe("OAuth", () => {
  const env = { AUTH_SECRET: "s3cret", APP_URL: "https://beam.example.com", AUTH_GOOGLE_CLIENT_ID: "gid", AUTH_GOOGLE_CLIENT_SECRET: "gsec" };
  it("builds an authorization URL with PKCE and the fixed callback", () => {
    const { challenge } = pkcePair();
    const url = new URL(authorizationUrl("google", oauthConfig("google", env), "state1", challenge, env));
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri("google", env));
    expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/v1\/connections\/google\/callback$/);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("gmail.metadata");
    expect(url.searchParams.get("access_type")).toBe("offline");
  });
  it("accepts only its own signed, unexpired state", () => {
    const state = { state: "abc", verifier: "v", userId: "u", workspaceId: "w", provider: "google" as const, expiresAt: Date.now() + 60_000 };
    const cookie = signState(state, env);
    expect(verifyState(cookie, "abc", env)).toMatchObject({ userId: "u" });
    expect(verifyState(cookie, "other", env)).toBeNull();
    expect(verifyState(cookie.replace(/.$/, "x"), "abc", env)).toBeNull();
    expect(verifyState(signState({ ...state, expiresAt: Date.now() - 1 }, env), "abc", env)).toBeNull();
  });
  it("keeps the old refresh token when the provider sends none", async () => {
    const http = mockHttp((req) => (req.method === "POST" ? ok(JSON.stringify({ access_token: "new", expires_in: 3600 })) : undefined));
    const next = await refreshTokens(http, oauthConfig("google", env), { accessToken: "old", refreshToken: "r1", expiresAt: 0, scopes: [] });
    expect(next).toMatchObject({ accessToken: "new", refreshToken: "r1" });
  });
});
