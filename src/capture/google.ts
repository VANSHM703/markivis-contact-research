/**
 * Google capture (BRD 11.2, P1). Scopes: `gmail.metadata` (headers and labels, never bodies;
 * it does not allow the `q` search parameter, so the first run pages back by date) and
 * `calendar.events.readonly`. Incremental mail sync uses the Gmail history API from the last
 * history id; an expired history id (404) restarts from a bounded full list.
 */
import { assertOk, HttpError, type HttpClient } from "@/ingest/http";
import type { CapturedEvent, CapturedMessage, CaptureProvider } from "./types";

export const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
export const GCAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.metadata", "https://www.googleapis.com/auth/calendar.events.readonly"] as const;
const MAX_MESSAGES = 500;

/** Every address in a header such as `Jane Example <jane@example.com>, ops@example.com`. */
export function parseAddresses(header: string | undefined): string[] {
  if (!header) return [];
  return Array.from(header.matchAll(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g), (m) => m[0].toLowerCase());
}

interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string;
  payload?: { headers?: { name: string; value: string }[] };
}

export function toGmailMessage(m: GmailMessage): CapturedMessage {
  const header = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
  return {
    id: m.id,
    internetMessageId: header("Message-ID")?.trim() || m.id,
    conversationId: m.threadId,
    sentAt: new Date(Number(m.internalDate)).toISOString(),
    from: parseAddresses(header("From"))[0] ?? null,
    to: parseAddresses(header("To")),
    cc: parseAddresses(header("Cc")),
    subject: header("Subject") ?? null,
  };
}

export function createGoogleProvider(http: HttpClient, accessToken: () => Promise<string>): CaptureProvider {
  async function get<T>(url: string): Promise<T> {
    const response = await http.request({ method: "GET", url, headers: { authorization: `Bearer ${await accessToken()}`, accept: "application/json" } });
    assertOk(response, "Google");
    return JSON.parse(response.text) as T;
  }
  const metadata = (id: string) => get<GmailMessage>(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Message-ID`);

  async function fullList(since: Date): Promise<{ ids: string[] }> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await get<{ messages?: { id: string }[]; nextPageToken?: string }>(`${GMAIL}/messages?maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`);
      const batch = page.messages ?? [];
      ids.push(...batch.map((m) => m.id));
      pageToken = page.nextPageToken;
      // Messages come newest first: stop once a page reaches back past the window.
      const last = batch.at(-1);
      if (last && Number((await metadata(last.id)).internalDate) < since.getTime()) break;
    } while (pageToken && ids.length < MAX_MESSAGES);
    return { ids };
  }

  return {
    name: "google",
    async accountEmail() {
      return (await get<{ emailAddress: string }>(`${GMAIL}/profile`)).emailAddress.toLowerCase();
    },

    async mailDelta(cursor, since) {
      const profile = await get<{ historyId: string }>(`${GMAIL}/profile`);
      const state = (cursor ? JSON.parse(cursor) : {}) as { historyId?: string };
      let ids: string[] = [];
      if (state.historyId) {
        try {
          let pageToken: string | undefined;
          do {
            const page = await get<{ history?: { messagesAdded?: { message: { id: string } }[] }[]; nextPageToken?: string }>(`${GMAIL}/history?startHistoryId=${state.historyId}&historyTypes=messageAdded${pageToken ? `&pageToken=${pageToken}` : ""}`);
            for (const h of page.history ?? []) for (const a of h.messagesAdded ?? []) ids.push(a.message.id);
            pageToken = page.nextPageToken;
          } while (pageToken && ids.length < MAX_MESSAGES);
        } catch (error) {
          if (!(error instanceof HttpError && error.status === 404)) throw error;
          ids = (await fullList(since)).ids;
        }
      } else ids = (await fullList(since)).ids;

      const messages: CapturedMessage[] = [];
      for (const id of Array.from(new Set(ids)).slice(0, MAX_MESSAGES)) {
        const m = toGmailMessage(await metadata(id));
        if (new Date(m.sentAt) >= since) messages.push(m);
      }
      return { messages, cursor: JSON.stringify({ historyId: profile.historyId }), more: false };
    },

    async calendarWindow(from, to) {
      const events: CapturedEvent[] = [];
      let pageToken: string | undefined;
      do {
        const page = await get<{ items?: { id: string; summary?: string; status?: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string }; attendees?: { email?: string }[]; organizer?: { email?: string } }[]; nextPageToken?: string }>(
          `${GCAL}?timeMin=${encodeURIComponent(from.toISOString())}&timeMax=${encodeURIComponent(to.toISOString())}&singleEvents=true&maxResults=250${pageToken ? `&pageToken=${pageToken}` : ""}`,
        );
        for (const e of page.items ?? []) {
          const at = (t: { dateTime?: string; date?: string }) => new Date(t.dateTime ?? `${t.date}T00:00:00Z`).toISOString();
          events.push({
            id: e.id,
            title: e.summary ?? null,
            startsAt: at(e.start),
            endsAt: at(e.end),
            organizer: e.organizer?.email?.toLowerCase() ?? null,
            attendees: (e.attendees ?? []).map((a) => a.email?.toLowerCase()).filter((x): x is string => !!x),
            cancelled: e.status === "cancelled",
          });
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
      return events;
    },
  };
}
