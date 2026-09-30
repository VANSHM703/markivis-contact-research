/**
 * A small, safe markdown renderer for AI briefs: `## ` headings, `- ` bullets and paragraphs, as
 * React text (never HTML), so model output cannot inject markup.
 */
import type { ReactNode } from "react";

export function Markdown({ text, headingLevel = 3 }: { text: string; headingLevel?: 2 | 3 }) {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={`ul-${out.length}`}>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>);
    bullets = [];
  };
  const Heading = headingLevel === 2 ? "h2" : "h3";
  for (const raw of text.split(/\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flush();
      out.push(<Heading key={`h-${out.length}`} className="t-heading-card">{line.slice(3)}</Heading>);
    } else if (/^[-*] /.test(line)) bullets.push(line.slice(2));
    else if (line.trim()) {
      flush();
      out.push(<p key={`p-${out.length}`}>{line}</p>);
    } else flush();
  }
  flush();
  return <>{out}</>;
}
