/** HTML to text for feeds, filings and leadership pages. Scripts, styles and hidden elements are dropped. */
import { Parser } from "htmlparser2";

const BLOCK = new Set([
  "p", "div", "br", "li", "ul", "ol", "tr", "td", "th", "table", "section", "article", "header", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6", "dt", "dd", "dl", "figure", "figcaption", "blockquote", "pre", "hr", "main", "aside",
]);
const SKIP = new Set(["script", "style", "noscript", "template", "svg", "head", "iframe"]);

/** Visible text, one line per block element, whitespace collapsed, empty lines removed. */
export function htmlToLines(html: string): string[] {
  const lines: string[] = [];
  let current = "";
  let skipDepth = 0;
  const flush = () => {
    const line = current.replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
    current = "";
  };
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (skipDepth > 0 || SKIP.has(name) || "hidden" in attrs || attrs["aria-hidden"] === "true" || /display:\s*none/i.test(attrs.style ?? "")) {
          if (!["br", "hr", "img", "input", "meta", "link"].includes(name)) skipDepth++;
          return;
        }
        if (BLOCK.has(name)) flush();
      },
      ontext(text) {
        if (skipDepth === 0) current += text;
      },
      onclosetag(name) {
        if (skipDepth > 0) {
          if (!["br", "hr", "img", "input", "meta", "link"].includes(name)) skipDepth--;
          return;
        }
        if (BLOCK.has(name)) flush();
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  parser.write(html);
  parser.end();
  flush();
  return lines;
}

export function htmlToText(html: string): string {
  return htmlToLines(html).join("\n");
}

/** Plain text, cut at a word boundary to at most `max` characters. */
export function excerpt(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd();
}
