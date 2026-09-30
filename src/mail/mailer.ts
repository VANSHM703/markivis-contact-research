/**
 * Platform email (BRD 12.8, 20.1): the digest and alerts, sent from MAIL_FROM through SMTP_URL.
 * In mock mode nothing leaves the machine; each message is kept in the notifications outbox,
 * which Settings shows. Messages from a partner's own mailbox are a different path (src/outreach).
 */
import { randomUUID } from "node:crypto";
import { getDataMode } from "@/config/env";
import { log } from "@/lib/log";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  mode: "mock" | "smtp";
  send(mail: OutgoingMail): Promise<{ messageId: string }>;
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super("Email is not set up: set SMTP_URL and MAIL_FROM for this deployment.");
  }
}

function mockMailer(): Mailer {
  return {
    mode: "mock",
    async send(mail) {
      const messageId = `mock-${randomUUID()}`;
      log.info("mail.mock_sent", { to: mail.to, subject: mail.subject, messageId });
      return { messageId };
    },
  };
}

async function smtpMailer(url: string, from: string): Promise<Mailer> {
  const { createTransport } = await import("nodemailer");
  const transport = createTransport(url);
  return {
    mode: "smtp",
    async send(mail) {
      const info = await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text });
      return { messageId: String(info.messageId) };
    },
  };
}

export async function getMailer(env: NodeJS.ProcessEnv = process.env): Promise<Mailer> {
  if (getDataMode(env) === "mock") return mockMailer();
  if (!env.SMTP_URL || !env.MAIL_FROM) throw new MailNotConfiguredError();
  return smtpMailer(env.SMTP_URL, env.MAIL_FROM);
}
