# Newsletter engagement

Adapter for BRD 8.6 (`newsletter`), CSV implementation (P0). Upload a file in Settings, Sources; it is ingested immediately. The HubSpot marketing email implementation is P1.

**CSV columns:** `email, event, occurred_at, issue_title, link_url, topics`. `event` is `open`, `click`, `unsubscribe` or `subscribe`; `topics` is separated by semicolons and should use the workspace topic vocabulary.

**Rules**

- Every event is a raw item keyed by a hash of email, event, time and link, so uploading the same file twice changes nothing. Suppressed addresses are skipped before anything is stored.
- An address that matches no tracked person's business email is marked irrelevant and not applied.
- A click creates a `newsletter_click` interaction with the first topic as `content_topic`; an open creates `newsletter_open`, which weighs zero in scoring because open tracking is unreliable.
- `unsubscribe` sets newsletter consent to `opted_out` in the same job; `subscribe` sets `opted_in`.
- Three or more clicks on one topic within 30 days add that topic to the person's interests with source `first_party`. The `person_content_engagement` signal (priority 3) is raised by the pipeline in M4.
