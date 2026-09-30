/**
 * Activity capture (BRD 11.1 to 11.3): the shape every mailbox and calendar provider returns.
 * Metadata only: providers never ask for bodies or attachments.
 */
export type CaptureProviderName = "microsoft" | "google";

export interface CapturedMessage {
  /** The provider's message id. */
  id: string;
  /** RFC 5322 Message-ID, the idempotency key across folders. */
  internetMessageId: string;
  /** Provider conversation id, stored as the interaction's thread key. */
  conversationId: string | null;
  sentAt: string;
  from: string | null;
  to: string[];
  cc: string[];
  subject: string | null;
}

export interface CapturedEvent {
  id: string;
  title: string | null;
  startsAt: string;
  endsAt: string;
  organizer: string | null;
  attendees: string[];
  cancelled: boolean;
}

export interface MailDelta {
  messages: CapturedMessage[];
  /** Opaque cursor for the next run (for Graph, a delta link per folder). */
  cursor: string;
  /** More pages remain; the next run continues from the cursor. */
  more: boolean;
}

export interface CaptureProvider {
  name: CaptureProviderName;
  /** The mailbox address of the connected user. */
  accountEmail(): Promise<string>;
  mailDelta(cursor: string | null, since: Date): Promise<MailDelta>;
  calendarWindow(from: Date, to: Date): Promise<CapturedEvent[]>;
}

export class CaptureAuthError extends Error {}
