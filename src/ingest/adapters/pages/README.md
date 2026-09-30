# Leadership and board pages

Adapter for BRD 8.5 (`leadership_page`). Watches every address in a company's `leadership_page_urls` (set on the company's edit page).

- **robots.txt** is read once per site per run and matched against the product token `BEAMIntelligence`; a disallowed page is skipped. A missing robots.txt (4xx) allows everything; a server error fails the run so it is retried. The request User-Agent is `BEAMIntelligence/1.0 (+https://beam.markivis.com/intelligence)`.
- **Pace:** at most one request per domain per 10 seconds, plus random jitter between companies in live mode, on a weekly schedule (Monday 03:00 workspace time).
- **Snapshots:** each capture is a raw item whose payload holds the page's visible text as lines, keyed `page:<url hash>:<content hash>`. The first capture is a baseline and is marked irrelevant for the pipeline. A later capture that differs is compared line by line; if the lines added or removed include a name or a title, the raw item carries `added` and `removed` and goes to the pipeline; otherwise it is kept as the new baseline only.
- **Mock mode:** `fixtures/pages/<host><path>.before.html` and `.after.html`. The first run captures "before", the second produces the diff to "after".

Documentation: Robots Exclusion Protocol, RFC 9309, https://www.rfc-editor.org/rfc/rfc9309 ; robots-parser, https://github.com/samclarke/robots-parser
