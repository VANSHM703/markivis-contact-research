/**
 * Sending an approved email from the partner's own mailbox (BRD 12.5). The mock provider stands
 * in for Microsoft Graph and Gmail: it returns a message and conversation id and sends nothing.
 * The live providers arrive with mailbox connections (M7) and sending (M9); until then live mode
 * refuses with an error that says how to fix it.
 */
import { randomUUID } from "node:crypto";
import { getDataMode } from "@/config/env";

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
  /** Conversation id, stored as the interaction's thread key so replies can be matched (M9). */
  threadKey: string;
}

export interface MailboxSender {
  send(message: MailboxMessage): Promise<SentMessage>;
}

export class SendError extends Error {}

export function mockMailboxSender(): MailboxSender {
  return {
    async send() {
      const id = randomUUID();
      return { provider: "mock", messageId: `mock-msg-${id}`, threadKey: `mock-conv-${id}` };
    },
  };
}

export function getMailboxSender(env: NodeJS.ProcessEnv = process.env): MailboxSender {
  if (getDataMode(env) === "mock") return mockMailboxSender();
  return {
    async send() {
      throw new SendError("Couldn't send: no mailbox is connected for this partner. Connect it in Settings.");
    },
  };
}
