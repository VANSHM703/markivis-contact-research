/**
 * Mock capture provider (BRD 17.4, 21): reads a mailbox delta and a calendar from fixtures under
 * fixtures/capture/<provider>/<mailbox address>/, generated from the seed. The first run returns
 * mail.json, the next mail-2.json when it exists, then nothing new.
 */
import { readJsonFixture } from "@/ingest/fixtures";
import type { CapturedEvent, CapturedMessage, CaptureProvider, CaptureProviderName } from "./types";

export function createMockProvider(name: CaptureProviderName, accountEmail: string, now: () => Date = () => new Date()): CaptureProvider {
  const dir = `capture/${name}/${accountEmail.toLowerCase()}`;
  return {
    name,
    async accountEmail() {
      return accountEmail.toLowerCase();
    },
    async mailDelta(cursor) {
      const page = cursor === null ? 1 : Number(/^mock:(\d+)$/.exec(cursor)?.[1] ?? 0) + 1;
      const file = await readJsonFixture<{ messages: CapturedMessage[] }>(page === 1 ? `${dir}/mail.json` : `${dir}/mail-${page}.json`, now());
      if (!file) return { messages: [], cursor: cursor ?? "mock:0", more: false };
      return { messages: file.messages, cursor: `mock:${page}`, more: false };
    },
    async calendarWindow(from, to) {
      const file = await readJsonFixture<{ events: CapturedEvent[] }>(`${dir}/calendar.json`, now());
      return (file?.events ?? []).filter((e) => new Date(e.endsAt) >= from && new Date(e.startsAt) <= to);
    },
  };
}
