# Apollo

Adapter for BRD 8.1 (`apollo`). The workspace's API key is stored encrypted in `workspace_secrets` (kind `apollo_api_key`) from Settings, Sources, and is never returned by any API.

**Calls (read 2026-09-30)**

| Purpose | Request | Credits |
|---|---|---|
| People, up to 10 per call | `POST https://api.apollo.io/api/v1/people/bulk_match` with `{ "details": [...] }`; `reveal_personal_emails=false`, `reveal_phone_number=false` | 1 per person found with data |
| Organization firmographics | `GET https://api.apollo.io/api/v1/organizations/enrich?domain=` | 1 per organization |
| Health check | `POST https://api.apollo.io/api/v1/usage_stats/api_usage_stats` | 0 (needs a master key; a 403 still proves the key) |

Authentication: the `x-api-key` header. Default rate limit on the documented plans: 600 calls per hour.

**Behaviour**

- **Emails** go through provenance (source `apollo`): high confidence when Apollo says `verified`, low otherwise. Anything not verified is stored with `email_status = guessed` and is never used for sending until verified.
- **Job changes:** the client's plan may lack job-change alerts, so every tracked person is re-enriched weekly (Sunday 02:00 workspace time) and Apollo's current employer and title are compared with our primary role. A difference becomes a raw item (`apollo:change:<person>:<fingerprint>`) for the pipeline.
- **Firmographics:** employee count and industry update the company through provenance; the Apollo organization ID is stored.
- **Credit guard:** credits are counted per workspace per month in `usage_counters`. The weekly sweep stops at `settings.apollo.monthly_credit_cap`; on-demand enrichment of a newly added person or company is essential and continues. An alert is recorded at 80% (emailed to the data steward from M5).
- **Intent topics:** the public API reference documents no intent endpoint, so none is called. `company_intent_spike` waits on confirmation of the client's plan (BRD 25, question 8).
- **Terms:** confirm that the client's Apollo terms permit storing this data before live use (BRD 18.5), and record the confirmation in DECISIONS.md.

Documentation: https://docs.apollo.io/reference/people-enrichment , https://docs.apollo.io/reference/bulk-people-enrichment , https://docs.apollo.io/reference/organization-enrichment , https://docs.apollo.io/reference/view-api-usage-stats
