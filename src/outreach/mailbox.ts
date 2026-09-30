/**
 * Sending an approved email from the partner's own mailbox (BRD 12.5), through the partner's
 * mailbox connection, once sending is allowed on it:
 *
 *   Microsoft Graph  POST /me/sendMail (permission Mail.Send, asked for separately). Graph returns
 *                    no id, so the sent message is matched when capture next reads Sent Items,
 *                    which also gives it its conversation id for reply detection.
 *   Gmail            POST users/me/messages/send (scope gmail.send), which returns the thread id.
 *
 * In mock mode, or on a demo connection, a mock provider returns ids and sends nothing.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDataMode } from "@/config/env";
import { withWorkspace } from "@/db/client";
import { oauthConnections } from "@/db/schema";
import { isMockConnection, providerAccessToken } from "@/capture/connections";
import { GMAIL } from "@/capture/google";
import { GRAPH, MICROSOFT_SEND_SCOPE } from "@/capture/microsoft";
import { assertOk, liveHttp, type HttpClient } from "@/ingest/http";

export interface MailboxMessage {
  fromUserId: string;
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
}

export interface SentMessage {
  provider: string;
  messageId: string;
  /** Conversation id, stored as the interaction's thread key so replies can be matched. Null until capture sees the message (Graph). */
  threadKey: string | null;
}

export interface MailboxSender {
  send(message: MailboxMessage): Promise<SentMessage>;
}

export class SendError extends Error {}

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const canSend = (scopes: string[]) => scopes.includes(MICROSOFT_SEND_SCOPE) || scopes.includes(GMAIL_SEND_SCOPE) || scopes.includes("mock-send");

export function mockMailboxSender(): MailboxSender {
  return {
    async send() {
      const id = randomUUID();
      return { provider: "mock", messageId: `mock-msg-${id}`, threadKey: `mock-conv-${id}` };
    },
  };
}

/** RFC 2822 plain-text message, base64url encoded, as Gmail's send API takes it. */
export function rfc2822(m: MailboxMessage): string {
  const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
  const text = [`From: ${m.fromEmail}`, `To: ${m.to}`, `Subject: ${header(m.subject)}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", m.body].join("\r\n");
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function graphSender(http: HttpClient, token: () => Promise<string>): MailboxSender {
  return {
    async send(m) {
      const response = await http.request({
        method: "POST",
        url: `${GRAPH}/me/sendMail`,
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: { message: { subject: m.subject, body: { contentType: "Text", content: m.body }, toRecipients: [{ emailAddress: { address: m.to } }] }, saveToSentItems: true },
      });
      assertOk(response, "Microsoft 365");
      return { provider: "microsoft", messageId: `sent:${randomUUID()}`, threadKey: null };
    },
  };
}

export function gmailSender(http: HttpClient, token: () => Promise<string>): MailboxSender {
  return {
    async send(m) {
      const response = await http.request({ method: "POST", url: `${GMAIL}/messages/send`, headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" }, body: { raw: rfc2822(m) } });
      assertOk(response, "Gmail");
      const sent = JSON.parse(response.text) as { id: string; threadId: string };
      return { provider: "google", messageId: `sent:${sent.id}`, threadKey: sent.threadId };
    },
  };
}

/** The sender for a partner's mailbox, or a SendError that says how to fix it (BRD 16.5). */
export async function getMailboxSender(workspaceId: string, fromUserId: string, options: { http?: HttpClient } = {}): Promise<MailboxSender> {
  if (getDataMode() === "mock") return mockMailboxSender();
  const [c] = await withWorkspace(workspaceId, (tx) => tx.select().from(oauthConnections).where(and(eq(oauthConnections.userId, fromUserId), eq(oauthConnections.status, "active"))).limit(1));
  if (!c) throw new SendError("Couldn't send: no mailbox is connected for this partner. Connect it in Settings.");
  if (isMockConnection(c)) return mockMailboxSender();
  if (!canSend(c.scopes)) throw new SendError("Couldn't send: sending is not switched on for this partner's mailbox. Allow sending in Settings, Mailbox and calendar.");
  const http = options.http ?? liveHttp({ timeoutMs: 30_000 });
  const token = providerAccessToken(c, http);
  return c.provider === "google" ? gmailSender(http, token) : graphSender(http, token);
}
