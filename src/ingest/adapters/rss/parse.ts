/** RSS 2.0 and Atom parsing (press release wires, BRD 8.3; Google Alerts, BRD 8.4). Pure. */
import { XMLParser } from "fast-xml-parser";
import { htmlToText } from "../../html";

export interface FeedEntry {
  id: string;
  link: string | null;
  title: string;
  summary: string;
  published: Date | null;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: true, processEntities: true });

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string => {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"]);
  return "";
};

function date(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Google Alerts links go through https://www.google.com/url?...&url=<target>; return the target. */
export function unwrapLink(link: string | null): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === "/url") return u.searchParams.get("url") ?? u.searchParams.get("q") ?? link;
  } catch {
    return null;
  }
  return link;
}

export class FeedParseError extends Error {}

export function parseFeed(xml: string): FeedEntry[] {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (error) {
    throw new FeedParseError(`The feed is not valid XML: ${(error as Error).message}`);
  }
  const rss = doc.rss as { channel?: { item?: unknown } } | undefined;
  if (rss?.channel) {
    return arr(rss.channel.item as Record<string, unknown>[]).map((item) => {
      const link = str(item.link) || null;
      const guid = str(item.guid);
      return {
        id: guid || link || str(item.title),
        link: unwrapLink(link),
        title: htmlToText(str(item.title)),
        summary: htmlToText(str(item["content:encoded"]) || str(item.description)),
        published: date(item.pubDate) ?? date(item["dc:date"]),
      };
    });
  }
  const feed = doc.feed as { entry?: unknown } | undefined;
  if (feed) {
    return arr(feed.entry as Record<string, unknown>[]).map((entry) => {
      const links = arr(entry.link as Record<string, string>[] | Record<string, string>);
      const href = (links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0])?.["@_href"] ?? null;
      return {
        id: str(entry.id) || href || str(entry.title),
        link: unwrapLink(href),
        title: htmlToText(str(entry.title)),
        summary: htmlToText(str(entry.content) || str(entry.summary)),
        published: date(entry.published) ?? date(entry.updated),
      };
    });
  }
  throw new FeedParseError("This is not an RSS or Atom feed.");
}

/** Fixture file name for a feed URL: "https://wire.example.net/rss/a" becomes "wire.example.net_rss_a.xml". */
export function fixtureNameForUrl(url: string): string {
  return `${url.replace(/^https?:\/\//, "").replace(/[^A-Za-z0-9.-]+/g, "_").replace(/_+$/, "")}.xml`;
}
