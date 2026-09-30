# Press release wires and Google Alerts

Adapters for BRD 8.3 (`press_wire`) and 8.4 (`google_alert`). Both read RSS 2.0 or Atom feeds listed in the feed's `config.urls`; wires can also have `config.keywords` (an item must contain one) and `config.terms_url`.

- **Wires:** only the title, link, date and an excerpt of at most 2,000 characters are stored, because feed terms vary. Record each feed's terms page in `terms_url`. Whether a release is a primary source (on the company's own domain, or issued by the company) is decided by the pipeline in M4 from `payload.link_host`.
- **Google Alerts:** a team member creates each alert in Google Alerts with delivery set to RSS feed, then pastes the feed address into Settings, Sources. Alert links go through a `google.com/url?...&url=` redirect; the adapter stores the target address.
- **External ID:** a hash of the feed address and the entry's `guid` or Atom `id`, so a repeated item is stored once.
- **Mock mode:** a feed address maps to a file under `fixtures/wires/` or `fixtures/alerts/`, named after the address (see `fixtureNameForUrl`).

Documentation: RSS 2.0 specification, https://www.rssboard.org/rss-specification ; Atom, RFC 4287, https://www.rfc-editor.org/rfc/rfc4287 ; Google Alerts help, https://support.google.com/websearch/answer/4815696
