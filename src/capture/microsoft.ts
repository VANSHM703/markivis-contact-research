/**
 * Microsoft Graph capture (BRD 11.1). Permissions, checked against the Graph reference on
 * 2026-09-30: `Mail.ReadBasic` is the least-privileged delegated permission for message delta
 * (it excludes body and attachments) and `Calendars.ReadBasic` for calendarView (it excludes
 * body and attachments). `offline_access` gives a refresh token; `User.Read` reads the address.
 * Delta runs per folder (Inbox and Sent Items); each folder's delta link is the cursor.
 */
import { assertOk, type HttpClient } from "@/ingest/http";
import type { CapturedEvent, CapturedMessage, CaptureProvider, MailDelta } from "./types";

export const GRAPH = "https://graph.microsoft.com/v1.0";
export const MICROSOFT_SCOPES = ["offline_access", "User.Read", "Mail.ReadBasic", "Calendars.ReadBasic"] as const;
export const MICROSOFT_SEND_SCOPE = "Mail.Send";
const FOLDERS = ["inbox", "sentitems"] as const;
const SELECT = "internetMessageId,conversationId,sentDateTime,from,toRecipients,ccRecipients,subject";
const MAX_PAGES = 20;

type Address = { emailAddress?: { address?: string | null } | null } | null | undefined;
const addr = (a: Address) => a?.emailAddress?.address?.trim().toLowerCase() || null;

interface GraphMessage {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  sentDateTime?: string;
  from?: Address;
  toRecipients?: Address[];
  ccRecipients?: Address[];
  subject?: string | null;
  "@removed"?: unknown;
}

export function toMessage(m: GraphMessage): CapturedMessage | null {
  if (m["@removed"] || !m.sentDateTime) return null;
  return {
    id: m.id,
    internetMessageId: m.internetMessageId ?? m.id,
    conversationId: m.conversationId ?? null,
    sentAt: m.sentDateTime,
    from: addr(m.from),
    to: (m.toRecipients ?? []).map(addr).filter((x): x is string => !!x),
    cc: (m.ccRecipients ?? []).map(addr).filter((x): x is string => !!x),
    subject: m.subject ?? null,
  };
}

export function createMicrosoftProvider(http: HttpClient, accessToken: () => Promise<string>): CaptureProvider {
  async function get<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const response = await http.request({ method: "GET", url, headers: { authorization: `Bearer ${await accessToken()}`, accept: "application/json", ...headers } });
    assertOk(response, "Microsoft Graph");
    return JSON.parse(response.text) as T;
  }

  return {
    name: "microsoft",
    async accountEmail() {
      const me = await get<{ mail?: string | null; userPrincipalName?: string }>(`${GRAPH}/me?$select=mail,userPrincipalName`);
      return (me.mail ?? me.userPrincipalName ?? "").toLowerCase();
    },

    async mailDelta(cursor, since) {
      const links = (cursor ? JSON.parse(cursor) : {}) as Record<string, string>;
      const messages: CapturedMessage[] = [];
      let more = false;
      for (const folder of FOLDERS) {
        // The first round is bounded by time; later rounds follow the saved link.
        let url: string | undefined = links[folder] ?? `${GRAPH}/me/mailFolders/${folder}/messages/delta?$select=${SELECT}&$filter=receivedDateTime+ge+${since.toISOString()}`;
        for (let page = 0; url && page < MAX_PAGES; page++) {
          const body: { value: GraphMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string } = await get(url, { prefer: "odata.maxpagesize=50" });
          for (const m of body.value) {
            const message = toMessage(m);
            if (message) messages.push(message);
          }
          if (body["@odata.deltaLink"]) {
            links[folder] = body["@odata.deltaLink"];
            url = undefined;
          } else {
            url = body["@odata.nextLink"];
            if (url) links[folder] = url;
          }
        }
        if (url) more = true;
      }
      return { messages, cursor: JSON.stringify(links), more } satisfies MailDelta;
    },

    async calendarWindow(from, to) {
      const events: CapturedEvent[] = [];
      let url: string | undefined = `${GRAPH}/me/calendarView?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}&$select=subject,start,end,attendees,organizer,isCancelled&$top=100`;
      for (let page = 0; url && page < MAX_PAGES; page++) {
        const body: { value: { id: string; subject?: string; start: { dateTime: string }; end: { dateTime: string }; attendees?: Address[]; organizer?: Address; isCancelled?: boolean }[]; "@odata.nextLink"?: string } = await get(url, { prefer: 'outlook.timezone="UTC"' });
        for (const e of body.value) {
          const utc = (v: string) => (/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : `${v}Z`);
          events.push({
            id: e.id,
            title: e.subject ?? null,
            startsAt: new Date(utc(e.start.dateTime)).toISOString(),
            endsAt: new Date(utc(e.end.dateTime)).toISOString(),
            organizer: addr(e.organizer),
            attendees: (e.attendees ?? []).map(addr).filter((x): x is string => !!x),
            cancelled: !!e.isCancelled,
          });
        }
        url = body["@odata.nextLink"];
      }
      return events;
    },
  };
}
