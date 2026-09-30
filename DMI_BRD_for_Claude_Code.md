# BEAM Decision-Maker Intelligence: Build Specification for Claude Code

Version 3.0, 29 September 2026. Owner: Amit Khanduja, Founder and CEO, Markivis.
Companion file: `BEAM_DESIGN_LANGUAGE.md` (all visual and UI rules). Both files must sit in the repository root before work starts.

---

## 0. Read this first: how Claude Code should use this document

This document is self-contained. It was written in a different session, on a different machine, from a business requirements document (v2) and a market review. You have no access to that conversation, to any claude.ai artifact, to Markivis's memory, or to any connector that session had. Everything you need is in this file and in `BEAM_DESIGN_LANGUAGE.md`. If something is not here, it has not been decided.

**Working rules.**

1. Read this file and `BEAM_DESIGN_LANGUAGE.md` in full before writing code.
2. Run the repository detection procedure in section 3.3 before choosing any technology.
3. Keep a `DECISIONS.md` at the repository root. Log every choice this document leaves open, with the date, the choice, and the reason. Keep it short.
4. When a requirement is ambiguous, check section 25 (open questions). Each open question has a default. Use the default, log it in `DECISIONS.md`, and continue. Stop and ask only when a question is marked **Blocking** and no default applies.
5. Never invent an external API endpoint, field name, rate limit or scope. For every third-party service (Apollo, SEC EDGAR, Microsoft Graph, Google APIs, HubSpot, Anthropic), read the provider's current documentation before implementing its adapter, and record the documentation URL in the adapter's README.
6. Every external integration sits behind an adapter interface with a mock implementation. The whole product must run end to end on a laptop with no credentials, using `DATA_MODE=mock` and the seed data in section 21.
7. Write tests as you go. Section 22 lists the acceptance tests that define "done".
8. Interface copy and AI drafts use plain, formal US English, because BEAM's market and the first client are US-based (this specification itself is written in British English; do not copy its spelling into the interface). Never use an em dash in interface copy or documentation; use a colon, comma or full stop instead.

**Priority labels used in this document.**

- **P0**: required for launch. The product does not ship without it.
- **P1**: build if time allows before launch; otherwise first fast follow.
- **P2**: out of scope for launch. Design the schema and interfaces so it can be added without migration pain.

---

## 1. Product summary

**What it is.** A relationship intelligence tool inside BEAM. It holds one trusted record of every senior decision-maker at a client's target companies, detects changes about those people and companies within days, measures how well the client knows each person, and turns each confirmed change into a specific next action with a drafted message.

**Who it is for first.** The first workspace is a US-based retained executive search practice whose partner recruits at CEO, CXO, SVP and VP level. Markivis runs outreach, research and validation on the partner's behalf. The tool is built multi-tenant so other BEAM clients can use it; executive-search behaviour is packaged as a per-workspace module (section 13).

**The problem.** Senior executives move, companies change hands, and boards refresh. The partner learns about these events late, from scattered sources, with no single record of who he knows, how well, or what was last said. Warm moments pass before anyone acts.

**The outcome that matters.** Meetings and mandates that the tool triggered or enabled. Accuracy is necessary but not sufficient: a correct database that does not change what the partner does has failed.

**Goals (measured after launch).**

| Goal | Target | Measured by |
|---|---|---|
| Priority 1 changes acted on within 5 working days | 60% or more | Actions with status sent or done, divided by confirmed P1 signals |
| Public event to confirmed signal, primary sources | 1 working day or less | `signals.confirmed_at - signal_sources.published_at` |
| Public event to confirmed signal, other sources | 3 working days or less | Same, other source types |
| Oldest pending item in the validation queue | 5 working days or less | Queue age report |
| Interactions with tracked people captured automatically | 90% or more | Auto-captured interactions divided by all interactions |
| Priority targets with a warm path | 50% or more | Target-tier-1 people with at least one path of strength 0.4 or more |
| Meetings and mandates influenced | Baseline in month 2, then grow | Action outcomes |

**Non-goals.**

- Automated reading or scraping of LinkedIn. LinkedIn's terms prohibit it and it risks the team's accounts. LinkedIn stays manual.
- Sending any message without a named person's approval. The tool drafts; people send.
- Search execution (candidate pipelines, shortlists, client reporting). That stays in the client's executive search system.
- Storing personal contact details that the person did not supply.
- Native mobile apps. The web interface must work in a phone browser.

---

## 2. Launch scope: Release 1 and Release 2 go live together

The v2 business requirements split the product into three gated releases. This build ships **Release 1 and Release 2 in a single launch**. Release 3 capabilities are designed for (schema, adapter interfaces, feature flags) but are switched off at launch.

Because the original gate between Release 1 and Release 2 existed to prove the validation workload before adding relationship features, this build replaces that gate with two safeguards: a 14-day **shadow run** before users see any signal (section 24), and **per-workspace feature flags** so any Release 2 capability can be switched off without a deployment.

| Capability | Origin | Launch | Flag |
|---|---|---|---|
| Person, Role, Company data model with field-level provenance | R1 | P0 | none |
| Target list import (CSV) and manual entry | R1 | P0 | none |
| Apollo sync: people, companies, emails, job changes, intent | R1 | P0 | `source.apollo` |
| SEC EDGAR Form 8-K Item 5.02 monitoring | R1 | P0 | `source.sec` |
| Press release wire monitoring (RSS) | R1 | P0 | `source.wires` |
| Google Alerts monitoring (RSS) | R1 | P0 | `source.alerts` |
| Company leadership and board page monitoring | R1 | P0 | `source.pages` |
| Signal pipeline: match, classify, dedupe, confidence, priority, lane | R1 | P0 | none |
| Validation lanes: auto-confirm, review, weekly batch, more research | R1 | P0 | `validation.batch_p3` |
| Action cards with suggested action and AI draft | R1 | P0 | none |
| Manual interaction logging and forwarding address | R1 | P0 (form), P1 (forwarding) | none |
| Newsletter engagement import | R1 | P0 | `source.newsletter` |
| Executive search pack: contact type, off-limits, placements, confidential notes | R1 | P0 | `pack.exec_search` |
| Today dashboard and daily digest | R1 | P0 | none |
| Email and calendar activity capture (Microsoft 365 first, Google second) | R2 | P0 (M365), P1 (Google) | `capture.microsoft`, `capture.google` |
| Relationship strength score and bands | R2 | P0 | `rel.scoring` |
| Going-quiet alerts | R2 | P0 | `rel.quiet` |
| Connections derived from shared boards and tenure | R2 | P0 | `rel.connections` |
| Warm path finder | R2 | P0 | `rel.paths` |
| Meeting briefs before calendar events | R2 | P0 | `rel.briefs` |
| Send approved messages from the partner's mailbox | R2 | P0 | `send.mailbox` |
| Two-way CRM sync (HubSpot first) | R2 | P1 | `crm.hubspot` |
| Coverage map | R2 | P0 | none |
| Relationship map (graph view of one executive's connections) | R2 | P1 | `rel.graph` |
| Consent, suppression, erasure, export, audit, retention review | R3 in v2, moved to launch | P0 | none |
| PE sponsor and portfolio mapping (UI and signals) | R3 | P2 (schema at launch) | `pack.pe_mapping` |
| Licensed executive data (for example BoardEx) | R3 | P2 | `source.licensed` |
| News API, state WARN notices, job-posting volumes | R3 | P2 | `source.news`, `source.warn`, `source.jobs` |

Compliance moved into launch because activity capture processes the partner's mailbox metadata from day one.

---

## 3. Placement inside BEAM

### 3.1 Product identity

- Product name in the interface: **Decision-Maker Intelligence**. Store it in one config constant (`PRODUCT_NAME`) so it can change without a code search.
- Brand lockup: the BEAM mark, the word `BEAM`, and the sub-label `Decision-Maker Intelligence`, exactly as specified in `BEAM_DESIGN_LANGUAGE.md` section 3.
- Public path: `beam.markivis.com/intelligence`. Store the base path in `APP_BASE_PATH` (default `/intelligence`). Every route, asset URL and cookie path must respect it, because the app will be mounted behind a reverse proxy alongside other BEAM tools (the SEO and AEO tool lives at `/seo`; the BEAM marketing site is served separately from HubSpot CMS).

### 3.2 What this tool shares with BEAM, and what it does not

| Concern | Rule |
|---|---|
| Visual language | Must match BEAM exactly. Use the tokens and components in `BEAM_DESIGN_LANGUAGE.md`. |
| Authentication | Reuse BEAM's authentication if the repository has one (section 3.3). Otherwise implement the reference auth in section 5.2 behind an interface so it can be swapped for BEAM single sign-on later. |
| Database | Own schema (`dmi`). Never write to another BEAM tool's tables. |
| Domain and cookies | Path-scoped cookies under `APP_BASE_PATH`. No cookie on the root domain. |
| Navigation back to BEAM | The brand lockup links to `/` (the BEAM home). A "Tools" menu is P1. |

### 3.3 Repository detection procedure (run first)

This work is happening on a different laptop. You may be inside the BEAM repository, or in an empty folder. Decide as follows and log the result in `DECISIONS.md`.

1. List the repository root. If it contains a BEAM application (look for a `package.json`, `pyproject.toml` or similar, and any reference to `beam`, `markivis`, `aeo`, `seo` or `studio` in configuration or source), you are **inside BEAM**.
2. **Inside BEAM:** use its language, framework, ORM, auth, job runner, test tools and deployment method. Add this product as a module or app in the same structure (for example `apps/intelligence` in a monorepo). Read its existing CSS or theme files and confirm the BEAM tokens match `BEAM_DESIGN_LANGUAGE.md`; where they differ, the design file wins and the difference goes in `DECISIONS.md`.
3. **Not inside BEAM:** build a standalone app with the reference stack in section 4.2, designed to be mounted at `APP_BASE_PATH` behind a proxy and to swap its auth for BEAM's later.
4. In either case, do not modify any other BEAM tool's code except to add a navigation link, and only if a shared navigation component exists.

---

## 4. Architecture

### 4.1 Components

```
                     ┌──────────────────────────────────────────────┐
  Browser  ────────► │  Web app (UI + API routes), base path        │
                     │  /intelligence                               │
                     └───────────────┬──────────────────────────────┘
                                     │ reads/writes
                     ┌───────────────▼──────────────────────────────┐
                     │  PostgreSQL (schema dmi, row-level security) │
                     └───────────────▲──────────────────────────────┘
                                     │ jobs table (Postgres-backed queue)
                     ┌───────────────┴──────────────────────────────┐
                     │  Worker + scheduler                          │
                     │  ingestion, pipeline, scoring, sync, digest  │
                     └───────┬───────────────┬──────────────┬───────┘
                             │               │              │
                 ┌───────────▼───┐   ┌───────▼──────┐  ┌────▼─────────────┐
                 │ Source        │   │ Mailbox and  │  │ AI adapter       │
                 │ adapters      │   │ CRM adapters │  │ (Anthropic API)  │
                 │ Apollo, SEC,  │   │ Graph, Gmail,│  │ extract, draft,  │
                 │ wires, alerts,│   │ HubSpot      │  │ brief, research  │
                 │ pages, news-  │   │              │  │                  │
                 │ letter        │   │              │  │                  │
                 └───────────────┘   └──────────────┘  └──────────────────┘
```

Every adapter has three implementations selected by `DATA_MODE`: `live`, `mock` (fixtures under `/fixtures/<adapter>/`), and `record` (live, but saves responses as new fixtures with personal data replaced by fictional values).

### 4.2 Reference stack (use only if not inside BEAM)

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript, strict mode | One language across UI, API and worker |
| Web framework | Next.js (App Router), server components, route handlers | Supports `basePath` for proxy mounting |
| Database | PostgreSQL 16 | Row-level security for tenancy; JSONB for provenance and settings |
| ORM and migrations | Drizzle ORM with SQL migrations | Readable SQL, explicit schema |
| Job queue and scheduler | pg-boss (Postgres-backed) | No extra infrastructure; jobs are transactional with data |
| Auth (fallback) | Auth.js with Microsoft Entra ID and Google providers | Enterprise identity providers enforce MFA |
| Validation | Zod | Shared schemas for API input and AI output |
| Styling | CSS custom properties from `BEAM_DESIGN_LANGUAGE.md`, CSS Modules | No utility framework needed; tokens are the source of truth |
| Tests | Vitest (unit, integration), Playwright (end to end), axe-core (accessibility) | |
| Packaging | Dockerfile for app and worker; `docker-compose.yml` with Postgres for local use | Runs on any laptop |

Record the exact versions installed in `DECISIONS.md`.

### 4.3 Processes

- `web`: serves UI and API.
- `worker`: runs queued jobs and the schedule in section 8.9. Scales horizontally; every job must be idempotent.
- `migrate`: runs migrations on deploy.

---

## 5. Tenancy, users, roles and permissions

### 5.1 Tenancy

- A **workspace** is one BEAM client. Every business table carries `workspace_id`.
- Enforce isolation twice: PostgreSQL row-level security policies keyed on a per-request setting (`SET LOCAL app.workspace_id`), and a query layer that refuses any query without a workspace scope. A test must prove that a user of workspace A cannot read one row of workspace B through any API route.
- Markivis staff can belong to several workspaces. A workspace switcher appears in the top bar only for users with more than one workspace.

### 5.2 Authentication (fallback when BEAM auth is absent)

- Sign-in with Microsoft Entra ID or Google. No passwords.
- Each workspace has an allow-list of email domains and individually invited addresses.
- MFA is enforced by the identity provider; the app records the `amr` claim where available.
- Sessions expire after 12 hours of inactivity.

### 5.3 Roles

| Role | Who | Summary |
|---|---|---|
| `partner` | The client's relationship owner | Sees everything in the workspace, including confidential mandate notes. Approves drafts. Sets off-limits. |
| `outreach_owner` | Markivis team member running outreach | Prepares and sends partner-approved messages. Sees interaction metadata, not email bodies or confidential notes. |
| `validator` | Research validator (Markivis) | Works the validation queue. Edits records under review. |
| `account_lead` | Client sponsor or Markivis account lead | Read access to records, coverage and outcomes. No confidential notes. |
| `data_steward` | Client administrator | Consent, suppression, erasure, export, members, audit log. |
| `platform_admin` | Markivis platform operator (not a workspace role) | Creates workspaces, sets packs and flags, sees usage and cost. Cannot read workspace data without a logged break-glass action. |

### 5.4 Permission matrix

| Capability | partner | outreach_owner | validator | account_lead | data_steward |
|---|---|---|---|---|---|
| View people, companies, signals | Yes | Yes | Yes | Yes | Yes |
| View confidential mandate notes | Yes | No | No | No | No |
| View email subject lines of captured interactions | Yes | Yes | No | No | No |
| Work the validation queue | Yes | No | Yes | No | No |
| Create and edit records manually | Yes | Yes | Yes | No | No |
| Merge and unmerge people | Yes | No | Yes | No | No |
| Approve a draft | Yes | No | No | No | No |
| Send an approved message | Yes | Yes | No | No | No |
| Dismiss an action | Yes | Yes | No | No | No |
| Set off-limits rules | Yes | No | No | No | No |
| Mark a thread or contact private | Yes | No | No | No | No |
| Connect own mailbox and calendar | Yes | Yes | No | No | No |
| Manage members and roles | Yes | No | No | No | Yes |
| Consent, suppression, erasure | No | No | No | No | Yes |
| Export all data | No | No | No | No | Yes |
| View audit log | Yes | No | No | No | Yes |
| Change scoring weights, SLAs, feeds | Yes | No | No | No | Yes |

The partner may delegate approval to a named outreach owner per workspace setting `approval.delegate_user_id` (P1). Delegation is logged.

---

## 6. Data model

All tables live in schema `dmi`. Every table has `id uuid primary key default gen_random_uuid()`, `workspace_id uuid not null references workspaces(id)` (except `workspaces`, `users`), `created_at timestamptz not null default now()` and `updated_at timestamptz not null default now()` unless stated. Types below are PostgreSQL. Enums are PostgreSQL enums or check constraints; choose one approach and use it everywhere.

### 6.1 Core records

**workspaces**

| Column | Type | Notes |
|---|---|---|
| name | text not null | |
| slug | text unique not null | |
| timezone | text not null default 'America/New_York' | Digest and SLA clock |
| packs | jsonb not null default '{}' | `{ "exec_search": true, "pe_mapping": false }` |
| flags | jsonb not null default '{}' | Feature flags from section 2 |
| settings | jsonb not null default '{}' | Scoring weights, thresholds, SLAs, digest time, style guide, AI budget. Defaults in section 20.3 |

**users**, **workspace_members** (`workspace_id`, `user_id`, `role`, `invited_by`, `status`). Unique on (`workspace_id`, `user_id`).

**persons**: one row per human being.

| Column | Type | Notes |
|---|---|---|
| full_name | text not null | |
| preferred_name | text | |
| name_normalised | text not null | Lowercase, accents stripped, honorifics and suffixes removed; used for matching |
| linkedin_url | text | Canonical form (`https://www.linkedin.com/in/<slug>`); unique per workspace when not null |
| city, region, country | text | Country is ISO 3166-1 alpha-2; drives consent jurisdiction |
| contact_types | text[] not null default '{}' | Exec search pack: `prospective_client`, `potential_candidate`, `referrer`, `sponsor_contact` |
| relationship_owner_id | uuid references users | Defaults to the partner |
| status | enum `person_status` | `active`, `no_current_role`, `do_not_contact` |
| is_tracked | boolean not null default true | Tracked people drive capture, scoring and signals |
| is_off_list | boolean not null default false | Current employer not on the target list |
| is_priority | boolean not null default false | Tier-1 targets; drives going-quiet and path metrics |
| merged_into_id | uuid references persons | Set when merged; merged rows are hidden, never deleted |

**companies**

| Column | Type | Notes |
|---|---|---|
| name | text not null | |
| name_normalised | text not null | Legal suffixes removed (Inc, LLC, Ltd, plc, Corp, Co) |
| aliases | text[] not null default '{}' | Brand names, former names, ticker |
| domain | text | Registrable domain, lowercase; unique per workspace when not null |
| sec_cik | text | Zero-padded 10 digits |
| ownership | enum `ownership_type` | `public`, `pe_backed`, `vc_backed`, `private`, `non_profit`, `unknown` |
| is_sponsor | boolean not null default false | True for PE firms |
| hq_country, hq_region | text | |
| industry | text | |
| employee_count | integer | |
| size_band | enum | `lt_200`, `200_999`, `1000_4999`, `5000_plus`, `unknown` |
| target_tier | smallint | 1, 2, 3 or null (not a target) |
| client_status | enum | `client`, `prospect`, `none` |
| apollo_org_id | text | |
| intent_topics | jsonb | Latest Apollo intent topics with scores and date |
| leadership_page_urls | text[] not null default '{}' | Monitored pages |

**roles**: one row per seat held at one organisation for one period.

| Column | Type | Notes |
|---|---|---|
| person_id | uuid not null references persons | |
| company_id | uuid not null references companies | |
| seat_type | enum `seat_type` | `executive`, `board`, `advisory`, `pe_operating_partner`, `pe_deal_partner`, `other` |
| title | text not null | As published |
| title_normalised | text | Mapped to a controlled list (CEO, CFO, COO, CTO, CIO, CHRO, CMO, CRO, GC, President, Chair, Director, VP, SVP, Other) |
| function | text | Finance, Technology, People, Operations, Sales, Marketing, Legal, General management, Board |
| seniority | enum | `c_suite`, `board`, `svp`, `vp`, `other` |
| business_email | text | Lowercase |
| email_status | enum | `verified`, `guessed`, `invalid`, `unknown` |
| announced_on | date | |
| effective_on | date | |
| ended_on | date | |
| status | enum `role_status` | `announced`, `current`, `ended` |
| is_primary | boolean not null default false | The person's main current role; at most one per person |

Unique on (`person_id`, `company_id`, `title_normalised`, `effective_on`).

**sponsor_links** (schema at launch; UI is P2): `sponsor_company_id`, `portfolio_company_id`, `deal_type`, `acquired_on`, `exited_on`, `deal_partner_person_id`.

**connections**: a known tie between two people.

| Column | Type | Notes |
|---|---|---|
| person_a_id, person_b_id | uuid not null | Stored with `person_a_id < person_b_id` |
| type | enum `connection_type` | `shared_board`, `overlapping_tenure`, `reported_to`, `deal_counterpart`, `introduced_by`, `manual_other` |
| company_id | uuid | The company where the tie formed, if any |
| period_start, period_end | date | Overlap period |
| weight | numeric(3,2) not null | 0.00 to 1.00, see section 11.5 |
| derived | boolean not null | True when computed from roles |
| note | text | Manual connections only |

Unique on (`person_a_id`, `person_b_id`, `type`, `company_id`).

### 6.2 Activity

**interactions**

| Column | Type | Notes |
|---|---|---|
| person_id | uuid not null | Always the Person, so history survives moves |
| role_id | uuid | The role held at the time, if known |
| channel | enum `channel` | `email`, `meeting`, `call`, `linkedin_request`, `linkedin_message`, `event`, `interview`, `newsletter_click`, `newsletter_open`, `download`, `note` |
| direction | enum | `outbound`, `inbound`, `two_way`, `not_applicable` |
| occurred_at | timestamptz not null | |
| our_user_id | uuid | Team member on our side |
| subject | text | Email subject or meeting title; hidden from roles without subject access |
| summary | text | Manual entries and AI summaries of opted-in threads only |
| thread_key | text | Provider conversation ID |
| provider | text | `microsoft`, `google`, `newsletter`, `manual`, `crm` |
| external_id | text | Unique per (`workspace_id`, `provider`, `external_id`) for idempotency |
| captured_by | enum | `auto`, `manual`, `import` |
| is_private | boolean not null default false | Counts toward scores; detail hidden from everyone but the partner |
| content_topic | text | For newsletter and download events |

**calendar_events**: `user_id`, `provider`, `external_id`, `starts_at`, `ends_at`, `title`, `attendee_emails text[]`, `person_ids uuid[]`, `brief_id`.

**oauth_connections**: `user_id`, `provider`, `scopes text[]`, `token_ciphertext bytea`, `token_key_id text`, `status` (`active`, `revoked`, `error`), `last_sync_at`, `delta_cursor text`, `error_message`.

### 6.3 Signals and provenance

**raw_items**: staging for everything fetched.

| Column | Type | Notes |
|---|---|---|
| source_type | enum `source_type` | `apollo`, `sec_8k`, `press_wire`, `google_alert`, `leadership_page`, `newsletter`, `event_site`, `manual`, `ai_research`, `licensed`, `news_api`, `warn`, `job_postings` |
| feed_id | uuid | |
| external_id | text not null | Unique per (`workspace_id`, `source_type`, `external_id`) |
| url | text | |
| title | text | |
| body_text | text | Cleaned text, max 50,000 characters |
| published_at | timestamptz | |
| payload | jsonb | Original parsed payload |
| processed_at | timestamptz | |
| outcome | enum | `irrelevant`, `signal_created`, `signal_merged`, `record_updated`, `error` |

**signals**

| Column | Type | Notes |
|---|---|---|
| subject_type | enum | `person`, `company` |
| person_id, company_id, role_id | uuid | At least one of person or company |
| type | enum `signal_type` | Section 9.3 |
| headline | text not null | One line, 140 characters maximum |
| evidence | text | Quote from the source, 300 characters maximum |
| event_on, announced_on, effective_on | date | |
| found_at | timestamptz not null | |
| found_by | enum | `ai_scan`, `apollo`, `feed_rule`, `team_member` |
| match_score | numeric(3,2) | AI or rule entity-match confidence, 0 to 1 |
| confidence | enum | `high`, `medium`, `low` |
| priority | smallint not null | 1, 2 or 3 |
| lane | enum | `auto_confirm`, `review`, `weekly_batch`, `more_research` |
| status | enum | `pending`, `confirmed`, `rejected`, `needs_info`, `parked`, `shadow` |
| research_cycles | smallint not null default 0 | Maximum 2 |
| dedupe_key | text not null | Section 9.5 |
| merged_into_id | uuid | |
| validated_by | uuid | |
| validated_at | timestamptz | |
| reject_reason | enum | `wrong_person`, `not_a_change`, `duplicate`, `out_of_date`, `not_relevant` |
| is_spot_check | boolean not null default false | Sampled for weekly auto-confirm audit |
| spot_check_result | enum | `correct`, `incorrect` |

**signal_sources**: `signal_id`, `raw_item_id`, `source_type`, `url`, `title`, `published_at`. A signal has one or more.

**field_sources**: provenance for key fields on any record.

| Column | Type | Notes |
|---|---|---|
| entity_type | text | `person`, `company`, `role` |
| entity_id | uuid | |
| field | text | For example `business_email`, `title`, `linkedin_url` |
| value | text | |
| source_type | enum `source_type` | |
| source_url | text | |
| captured_at | timestamptz | |
| last_checked_at | timestamptz | |
| confidence | enum | `high`, `medium`, `low` |
| is_current | boolean | The value shown on the record |
| in_conflict | boolean | True when another current-candidate value from a different source disagrees |

Rule: two sources that disagree are both kept; the field shows the higher-confidence value, sets `in_conflict = true` on both rows, and creates a review-lane item of type `data_conflict` (not a signal; a queue item, section 10.4).

### 6.4 Actions and outputs

**actions**

| Column | Type | Notes |
|---|---|---|
| signal_id | uuid | Null for manual or going-quiet actions without a signal |
| person_id | uuid not null | |
| type | enum `action_type` | `congratulate`, `check_in`, `introduction_request`, `invite_interview`, `invite_event`, `share_content`, `pause`, `reengage`, `custom` |
| status | enum | `open`, `drafted`, `awaiting_approval`, `approved`, `sent`, `done`, `dismissed`, `expired` |
| owner_user_id | uuid not null | |
| due_at | timestamptz not null | From SLA settings |
| best_path | jsonb | Path object from section 11.6 |
| why_it_matters | text | |
| dismiss_reason | enum | `not_relevant`, `already_known`, `wrong_timing`, `off_limits` |
| outcome | enum | `none`, `no_reply`, `replied`, `meeting`, `mandate` |
| outcome_at | timestamptz | |

**drafts**: `action_id`, `channel` (`email`, `linkedin_message`), `subject`, `body`, `version`, `author` (`ai`, `user`), `model`, `prompt_version`, `content_item_id`, `approved_by`, `approved_at`, `sent_at`, `provider_message_id`, `send_error`.

**briefs**: `person_id`, `calendar_event_id`, `content_markdown`, `model`, `prompt_version`, `generated_at`.

**relationship_scores**: primary key (`workspace_id`, `person_id`, `user_id`); `user_id` null means firm-level. Columns: `score smallint`, `band` enum (`strong`, `warm`, `cooling`, `cold`, `none`), `factors jsonb` (each factor's raw value and normalised value), `last_two_way_at`, `computed_at`.

**content_items**: thought papers, newsletter issues, interview clips. `title`, `url`, `topics text[]`, `published_on`. Used to suggest attachments in drafts.

### 6.5 Executive search pack tables

**off_limits**: `company_id`, `scope` (`company`, `function`, `level_and_above`), `function`, `min_seniority`, `reason` (`current_client`, `recent_placement`, `contractual`), `starts_on`, `ends_on`, `set_by`.

**placements**: `person_id`, `company_id`, `role_title`, `placed_on`, `search_reference`.

**mandate_notes**: `person_id` or `company_id`, `body`, `created_by`. Readable only by `partner`. Every read is written to the audit log.

### 6.6 Compliance and operations

**consents**: `person_id`, `channel` (`email`, `newsletter`, `linkedin`, `phone`), `purpose` (`outreach`, `newsletter`), `status` (`opted_in`, `opted_out`, `legitimate_interest`, `unknown`), `jurisdiction`, `captured_via`, `proof` text, `recorded_at`, `recorded_by`.

**suppressions**: `hash` (SHA-256 of a normalised email or LinkedIn URL with a per-workspace salt), `kind` (`email`, `linkedin`), `reason` (`erasure`, `opt_out`, `do_not_contact`), `created_at`. Checked by every import and adapter before a record is created.

**feeds**: `source_type`, `name`, `config jsonb`, `enabled`, `last_run_at`, `last_error`.

**source_stats_weekly**: `feed_id`, `week_start`, `raw_items`, `signals_created`, `confirmed`, `rejected`, `auto_confirmed`, `spot_check_errors`.

**audit_log** (append-only; no update or delete grants): `actor_user_id`, `actor_kind` (`user`, `system`, `platform_admin`), `action`, `entity_type`, `entity_id`, `before jsonb`, `after jsonb`, `ip`, `user_agent`, `at`.

**ai_calls**: `purpose`, `model`, `prompt_version`, `input_tokens`, `output_tokens`, `cost_usd numeric(10,4)`, `latency_ms`, `status`, `error`, `created_at`.

**workspace_secrets**: `kind` (`apollo_api_key`, `hubspot_private_app_token`, `newsletter_api_key`), `ciphertext bytea`, `key_id text`, `updated_by`. Write-only from the interface; never returned by any API.

**queue_items**: validation queue entries that are not signals (`data_conflict`, `possible_duplicate`). `kind`, `payload jsonb`, `status`, `resolved_by`, `resolved_at`.

### 6.7 Required indexes

At minimum: every foreign key; `persons(workspace_id, name_normalised)`; `persons(workspace_id, linkedin_url)`; `roles(workspace_id, business_email)`; `roles(person_id, status)`; `companies(workspace_id, domain)`; `companies(workspace_id, sec_cik)`; `signals(workspace_id, status, priority, found_at)`; `signals(workspace_id, dedupe_key)`; `interactions(workspace_id, person_id, occurred_at desc)`; `actions(workspace_id, owner_user_id, status, due_at)`; `raw_items(workspace_id, source_type, external_id)` unique.

---

## 7. Identity resolution and movement rules

### 7.1 Principle

Never merge two people on name alone. Many senior executives have no LinkedIn profile, and board members often have no email at the companies they oversee, so matching uses several keys in a fixed order.

### 7.2 Matching order for any incoming person reference

Normalise first: names via `name_normalised`, LinkedIn URLs to canonical form, emails lowercase, company references resolved to a `company_id` via domain, CIK, `name_normalised` or `aliases`.

| Step | Condition | Result |
|---|---|---|
| 1 | Exact canonical LinkedIn URL match | Same person |
| 2 | Exact business email on any past or current role (status not `invalid`) | Same person |
| 3 | Same `name_normalised` and at least one matching role (same company and same `title_normalised` or overlapping dates) | Same person; auto-linked; logged |
| 4 | Same `name_normalised` and same company or same city only | Possible duplicate: create a `queue_items` row of kind `possible_duplicate`; never auto-merge |
| 5 | No match | New person, subject to the suppression check |

Every merge writes an audit entry, keeps both field-source trails, repoints roles, interactions, signals and actions to the surviving person, sets `merged_into_id` on the other, and can be reversed by a validator or the partner from the person page within 90 days (the reverse restores the original pointers from the audit entry).

### 7.3 Movement rules

| Event | What the platform does | Signal type | Priority |
|---|---|---|---|
| Move announced, not yet effective | New role with status `announced`, `announced_on` and `effective_on`; a reminder action is scheduled 2 working days before `effective_on` | `person_move_announced` | 1 |
| Leaves an executive role | Role status `ended` with `ended_on`; person stays `active` if any other role is current, otherwise `no_current_role` after 90 days | `person_left` | 1 |
| Joins a new organisation | New role on the same person; new business email enriched and verified; old role ended if still current | `person_joined` | 1 |
| Joins or leaves a board | Board role opened or closed; executive roles untouched | `person_board_change` | 1 |
| Company acquired or merged | Company linked to acquirer (`sponsor_links` if the acquirer is a sponsor); roles unchanged until leadership signals arrive | `company_mna` or `company_pe_transaction` | 1 |
| Promoted or remit expanded in the same company | Current role ended, new role opened; history kept | `person_promotion` | 2 |
| Business email bounces | `email_status = invalid`; Apollo re-enrichment and a possible-move check are queued | `person_email_bounced` | 2 |
| Moves to a company outside the target list | Tracking continues; `is_off_list = true`; action card offers "Add company to target list" | per event | 2 |
| No current role for 90 days | Status `no_current_role`; kept for relationship history | none | none |

**Placement override (executive search pack).** If the person has a row in `placements`, every movement signal about them is priority 1 regardless of the table above.

**Primary role rule.** A person's primary role is their current executive role with the most senior `seniority`; if none, their most recent current board role. Recompute on every role change.

---

## 8. Sources and adapters

Each adapter implements:

```ts
interface SourceAdapter {
  key: SourceType;
  fetch(ctx: WorkspaceCtx, feed: Feed, since: Date): AsyncIterable<RawItemInput>; // idempotent, paginated
  healthCheck(ctx: WorkspaceCtx, feed: Feed): Promise<HealthResult>;
}
```

`RawItemInput` must carry a stable `external_id`. Adapters never create signals directly; they write `raw_items`, and the pipeline (section 9) does the rest. Adapters check the suppression list before writing anything that identifies a person.

### 8.1 Apollo (P0)

- **Purpose:** base people and company records, business emails with verification status, firmographics, job-change detection, company intent topics.
- **Method:** Apollo REST API. Read Apollo's current API documentation for people enrichment, bulk enrichment, organisation enrichment and any job-change feature before building. Record plan limits in the adapter README.
- **Rules:** emails Apollo marks as guessed or unverified are stored with `email_status = guessed` and never used for sending until verified. Intent is company-level only; store it on `companies.intent_topics` and raise `company_intent_spike` when a tracked topic's score crosses the workspace threshold (default: enters the top band Apollo reports, or rises by 20 points week on week).
- **Job changes without a job-change feature:** if the client's Apollo plan lacks job-change alerts, re-enrich every tracked person weekly and diff title and employer; a change creates a `raw_items` row of source `apollo`.
- **Schedule:** full re-enrichment weekly (Sunday 02:00 workspace time); on-demand enrichment when a person or company is added.
- **Credit guard:** track credits used per month; stop non-essential enrichment at the monthly cap in settings and alert the data steward at 80%.

### 8.2 SEC EDGAR, Form 8-K Item 5.02 (P0)

- **Purpose:** director and officer departures and appointments at US public companies. Primary source, eligible for auto-confirm.
- **Method:** SEC EDGAR public data. Read the SEC's current developer and fair-access guidance first; at the time of writing it requires a descriptive `User-Agent` with contact details and limits request rates, so implement a shared rate limiter well under the published limit. Poll recent filings for every tracked company with a `sec_cik`; select 8-K and 8-K/A filings whose items include 5.02; fetch the filing document and extract the Item 5.02 section text into `body_text`.
- **Schedule:** every 30 minutes, 06:00 to 22:00 US Eastern on business days; every 2 hours otherwise.
- **CIK resolution:** when a public company is added without a CIK, resolve it from the SEC's company ticker mapping and store it; if ambiguous, create a `queue_items` row.

### 8.3 Press release wires (P0)

- **Purpose:** appointments, funding, M&A, expansion, contract wins.
- **Method:** RSS or Atom feeds configured per workspace in `feeds.config` (list of feed URLs and optional keyword filters). Pre-filter items by company names, aliases and tracked person names (section 9.2) before any AI call.
- **Rule:** a release published on the company's own domain, or a wire release issued by the company itself (the release names the company as the issuer), counts as a primary source.
- **Schedule:** every 30 minutes.
- **Terms:** feed terms vary by wire. Record each feed's terms URL in `feeds.config.terms_url`; the adapter stores only title, link, date and a text excerpt of at most 2,000 characters.

### 8.4 Google Alerts (P0)

- **Purpose:** mentions of each tracked company and executive.
- **Method:** alerts are created by a team member in Google Alerts with delivery set to RSS; the feed URLs are pasted into feeds. The adapter reads the RSS. Expect noise; common names produce false matches, which the pipeline handles.
- **Schedule:** every 60 minutes.

### 8.5 Leadership and board pages (P0)

- **Purpose:** detect changes to published leadership teams.
- **Method:** fetch each URL in `companies.leadership_page_urls`, respect `robots.txt`, extract visible text, and diff against the previous snapshot stored in `raw_items.payload`. A diff that adds or removes a name or title creates a raw item containing both the added and removed lines.
- **Schedule:** weekly (Monday 03:00 workspace time), with random jitter per company.
- **Limit:** one request per domain per 10 seconds.

### 8.6 Newsletter platform (P0)

- **Purpose:** first-party interest signals and consent status.
- **Method:** adapter interface with a CSV implementation (P0) and a HubSpot marketing email implementation (P1). CSV columns: `email, event (open|click|unsubscribe|subscribe), occurred_at, issue_title, link_url, topics`.
- **Rules:** clicks create `interactions` of channel `newsletter_click` with `content_topic`; opens create `newsletter_open` but weigh zero in scoring (open tracking is unreliable). Unsubscribe events update `consents` for channel `newsletter` to `opted_out` within the same job. Three or more clicks on one topic within 30 days add that topic to the person's interests with source `first_party` and raise `person_content_engagement` (priority 3).
- **Schedule:** daily at 04:00 workspace time for API sources; immediately on CSV upload.

### 8.7 Event websites (P1)

Monitor configured speaker and sponsor pages like leadership pages. Matches create `person_speaking` signals. Manual entry of speaking slots is P0 (a form on the person page).

### 8.8 Release 3 adapters (P2, interfaces only)

Create the adapter interface files and mock implementations for `licensed` (for example BoardEx), `news_api`, `warn` and `job_postings`, with feature flags off. No live implementation at launch.

### 8.9 Job schedule summary

| Job | Schedule | Notes |
|---|---|---|
| `ingest.sec` | Every 30 min in US business hours; every 2 h otherwise | |
| `ingest.wires` | Every 30 min | |
| `ingest.alerts` | Every 60 min | |
| `ingest.pages` | Weekly, Monday 03:00 | Jittered |
| `ingest.apollo` | Weekly, Sunday 02:00; on demand | Credit guard |
| `ingest.newsletter` | Daily 04:00; on upload | |
| `pipeline.process` | Continuous, triggered by new raw items | Batches of 25 |
| `capture.mail` | Every 15 min per connected mailbox | Delta sync |
| `capture.calendar` | Every 15 min per connected calendar | Next 14 days and last 30 days |
| `rel.score` | Nightly 01:00; and within 5 min of a new interaction for that person | |
| `rel.connections` | Nightly 01:30 | |
| `rel.quiet` | Daily 06:00 | |
| `actions.sla` | Hourly | Overdue flags and escalations |
| `digest.daily` | Daily at workspace `digest_time` | Default 08:00 |
| `briefs.generate` | Hourly; generates for meetings starting in the next 20 to 26 hours | |
| `validation.spot_check` | Weekly, Monday 05:00 | Samples auto-confirmed signals |
| `stats.sources` | Weekly, Monday 05:30 | Reject-rate report |
| `crm.sync` | Every 15 min | P1 |
| `compliance.retention` | Monthly, first Monday | Review list for the data steward |

All times are workspace time unless stated.

---

## 9. Signal pipeline

### 9.1 Stages

```
raw_item
  → 1. pre-filter (deterministic name and alias match; drop if no candidate)
  → 2. extract (AI: is it relevant, what type, who, which dates, evidence)
  → 3. resolve (map to person, role, company with section 7 rules)
  → 4. apply record changes as proposals (never write to roles until confirmed, except in the auto-confirm lane)
  → 5. dedupe (merge with an existing signal on dedupe_key)
  → 6. confidence (rules in 9.4)
  → 7. priority (table in 9.3, plus overrides)
  → 8. lane (rules in 10.1)
  → 9. status: confirmed (auto lane) or pending (other lanes); in shadow mode, status = shadow
  → 10. on confirmation: apply record changes, create action (section 12)
```

Each stage is a pure function over typed input, unit-tested with fixtures. A raw item that fails any stage twice sets `outcome = error` and appears in the data health panel.

### 9.2 Pre-filter

Build, per workspace, an in-memory index of tracked company `name_normalised` values, aliases and domains, and tracked person `name_normalised` values. A raw item passes if its title or body contains at least one company match, or a person-name match that co-occurs with a tracked company or a leadership term (appointed, named, joins, resigns, steps down, retire, board, chief, president, director). SEC items for a tracked CIK always pass. The pre-filter output (candidate person and company IDs) is passed to the AI extraction step, which may only choose among those candidates.

### 9.3 Signal types, priority, auto-confirm eligibility and default action

| `signal_type` | Subject | Priority | Auto-confirm eligible | Default action | Why it matters (default copy) |
|---|---|---|---|---|---|
| `person_move_announced` | Person | 1 | Yes | `congratulate` before start date | Reach them before the new seat fills their calendar |
| `person_left` | Person | 1 | Yes | `check_in` | Find out what is next while the move is fresh |
| `person_joined` | Person | 1 | Yes | `congratulate` | New leaders review their bench early |
| `person_board_change` | Person | 1 | Yes | `congratulate` | Board seats shape succession decisions |
| `company_cxo_change` | Company | 1 | Yes | `check_in` with the board chair or new leader | A leadership change often starts a search |
| `company_pe_transaction` | Company | 1 | Yes | `check_in` with the sponsor's operating partner | New owners review leadership in the first year |
| `company_mna` | Company | 1 | Yes | `check_in` | Integration reshuffles leadership |
| `company_funding_ipo` | Company | 1 | Yes | `check_in` | New money comes with hiring targets |
| `person_promotion` | Person | 2 | No | `congratulate` | A larger remit often means new hires |
| `person_speaking` | Person | 2 | No | `invite_event` or arrange to meet there | A meeting point and a topic to reference |
| `person_email_bounced` | Person | 2 | Not applicable | `check_in` after re-verification | A bounce often means a move |
| `company_layoffs` | Company | 2 | No | `pause` | Change the angle or wait |
| `company_expansion` | Company | 2 | No | `check_in` | New territory needs new leaders |
| `company_hiring_surge` | Company | 2 | No | `check_in` | Investment in a function |
| `internal_relationship_quiet` | Person | 2 | Not applicable | `reengage` | A warm relationship is cooling |
| `person_award` | Person | 3 | No | `congratulate` | A low-pressure reason to get in touch |
| `person_content_engagement` | Person | 3 | Not applicable | `share_content` | Shows current priorities |
| `company_ceo_tenure_threshold` | Company | 3 | Not applicable | `share_content` (succession themes) | Long tenure often precedes a leadership review |
| `company_product_partnership` | Company | 3 | No | Reference in next message | Context for a relevant note |
| `company_intent_spike` | Company | 3 | Not applicable | `share_content` | Research activity worth a timely touch |
| `other` | Either | Set by validator | No | Set by validator | Catch-all |

`company_ceo_tenure_threshold` fires once per CEO when the current CEO role's tenure passes `settings.ceo_tenure_years` (default 7). `company_cxo_change` also creates or updates the person-level signal for the individual concerned; the two are linked through `role_id`.

### 9.4 Confidence rules

| Confidence | Rule |
|---|---|
| High | A primary source (SEC filing, a release on the company's own domain or issued by the company, the company's leadership page), or two independent sources of medium confidence for the same event |
| Medium | One reputable news outlet (configurable allow-list in settings), an event website, Apollo data, or a manual entry with a source note |
| Low | A single aggregator or blog, AI inference without a quoted source, or an unconfirmed tip |

When a second independent source merges into a signal, recompute confidence. Validators can override confidence; the override is logged.

### 9.5 Deduplication

`dedupe_key = <subject_id>:<signal_type>:<event_week>` where `event_week` is the ISO week of `event_on` (or `announced_on`, else `found_at`). A new signal with an existing `dedupe_key`, or with the same subject and type and an event date within 3 days of an existing signal, merges into it: its sources are added to `signal_sources`, confidence is recomputed, and the newer raw item is marked `signal_merged`. Validators therefore see one item per event.

---

## 10. Validation workflow

### 10.1 Lane assignment (applied in this order)

1. **Auto-confirm**: signal type is auto-confirm eligible, confidence is `high` because of a primary source, `match_score >= 0.90`, the person was matched by step 1, 2 or 3 of section 7.2 (or the subject is a company matched by domain or CIK), and the source type has not been suspended this week. Status becomes `confirmed` immediately (or `shadow` during the shadow run).
2. **Review**: every priority 1 or 2 signal not auto-confirmed.
3. **Weekly batch**: priority 3 with confidence `medium` or `high`, when the workspace flag `validation.batch_p3` is on (default on).
4. Everything else goes to **review**.

### 10.2 Validator actions

From the queue, a validator can:

- **Confirm** (optionally editing headline, type, dates, priority, confidence and the proposed record changes).
- **Reject** with one required reason (`wrong_person`, `not_a_change`, `duplicate`, `out_of_date`, `not_relevant`).
- **Needs more info**: sends the signal to the `more_research` lane. The AI research step (section 17.4) runs once; the result returns to review with added sources. After 2 cycles, the only options are confirm, reject or park.
- **Park**: keeps the signal out of the queue without deciding; parked items older than 30 days appear in data health.

Keyboard shortcuts on the queue: `c` confirm, `r` reject (opens reason menu), `m` more info, `p` park, `j`/`k` next and previous, `e` edit. Shortcuts are listed in a help popover and never fire while an input has focus.

### 10.3 Queue ordering and targets

Order: priority ascending, then `found_at` ascending (oldest first). Show age in working days. Items older than 3 working days are flagged in the digest; older than 5 working days, on the Today screen for the partner.

### 10.4 Non-signal queue items

`data_conflict` (two sources disagree on a field) and `possible_duplicate` (section 7.2 step 4) appear in the same queue with their own resolution controls (pick a value; merge or keep separate).

### 10.5 Weekly batch

A batch screen lists all weekly-batch items for the week with checkboxes checked by default. The validator unticks any item to open it individually, then approves the rest in one action. The approval is logged per signal.

### 10.6 Auto-confirm spot checks and the learning loop

- Each Monday, sample 10% of the previous week's auto-confirmed signals (minimum 5, or all if fewer) and put them in the queue flagged `is_spot_check`. The validator marks each `correct` or `incorrect`.
- If a source type's spot-check error rate exceeds 2% in a week, auto-confirm is suspended for that source type in that workspace until the data steward or partner re-enables it. The suspension appears on the Today screen.
- `stats.sources` computes weekly reject rates per feed. Any feed with a reject rate above 50% for 4 consecutive weeks is flagged in data health with the suggestion to tighten or remove it.
- Dismissal reasons on actions (section 12.7) are counted per signal type; the settings screen shows these counts beside each type's priority so the partner can re-rank types.

---

## 11. Relationship intelligence

### 11.1 Activity capture: Microsoft 365 (P0)

- Delegated OAuth through Microsoft Graph for each connecting user (partner and outreach owners). Request the least-privilege scopes that give message metadata without bodies and read-only calendar access. At the time of writing, Graph offers a basic mail read permission that excludes body and attachments, plus calendar read; verify the current permission names and use them. Sending (section 12.5) needs a separate send permission, requested only when the user enables sending.
- Use Graph delta queries for incremental sync. Store the delta cursor per connection.
- For each message, capture: internet message ID, conversation ID, sent time, from, to, cc, subject. Resolve every address against tracked people's role emails (current and past). Create an interaction only when at least one tracked person is a sender or recipient. Ignore every other message entirely; do not store its metadata.
- Direction: outbound if sent by our user; inbound if received. A conversation with at least one message in each direction within 30 days is `two_way` for scoring.
- Calendar: capture events in the last 30 days and next 14 days; attendees matched to tracked people create `meeting` interactions after the event ends, and populate `calendar_events.person_ids` for briefs.
- Tokens are encrypted at rest with envelope encryption (`TOKEN_ENCRYPTION_KEY` or a KMS key ID). Revocation by the user deletes tokens immediately and stops sync.

### 11.2 Activity capture: Google Workspace (P1)

Same behaviour through the Gmail and Google Calendar APIs, using the metadata-only Gmail scope and read-only calendar scope. The Gmail metadata scope is a restricted scope; Google may require app verification and a security assessment before external users can connect. Check the current requirements early and log the plan in `DECISIONS.md`. If the client uses Google Workspace, an internal OAuth client created in the client's own Google Cloud project avoids external verification; document that option in the admin guide.

### 11.3 Privacy controls on capture

- Metadata only by default. Bodies are never fetched unless the partner opts in for a specific thread (P1), in which case the AI may summarise that thread into `interactions.summary`; the body itself is not stored.
- A per-user exclusion list of email addresses and domains that are never captured (for example family, personal advisers).
- `is_private` on a contact or thread: counts toward scores; subject and summary are visible only to the partner.

### 11.4 Relationship strength score

Computed per person at firm level (`user_id` null) and per connected user. Default weights live in `settings.scoring` and are editable by the partner. All inputs use a trailing 12-month window unless stated.

```
R  (recency)      = exp( -days_since_last_two_way / 90 )            ; 0 if never two-way
F  (frequency)    = min( 1, two_way_touches_12m / 12 )              ; a touch = one two_way conversation, meeting or call
Rc (reciprocity)  = inbound_threads_12m / max(1, all_threads_12m)   ; threads where the person wrote at least once
D  (depth)        = min( 1, (3*meetings + 2*calls + 1*email_threads + 0.5*linkedin_touches) / 20 )
T  (tenure)       = min( 1, years_since_first_two_way / 5 )

score = round( 100 * (0.30*R + 0.25*F + 0.20*Rc + 0.15*D + 0.10*T) )
```

Newsletter opens weigh zero. Newsletter clicks, event attendance and interviews count as one `linkedin_touches`-equivalent unit each in D (weight 0.5) and do not count toward F.

**Bands** (defaults, editable): `strong` 70 to 100; `warm` 45 to 69; `cooling` 25 to 44; `cold` 1 to 24; `none` 0 or no interactions.

Store each factor's raw and normalised value in `factors`. The person page shows the band, the score, and the five factors with their values, so the partner can see why a relationship reads as cooling.

**Calibration (launch task).** Provide an admin screen where the partner ranks 30 people he knows well, blind to the scores; show the rank correlation with computed scores and let him adjust weights. Log the chosen weights in `DECISIONS.md`.

### 11.5 Going-quiet alerts

Daily, for every `is_priority` person whose firm-level band was `strong` or `warm` at any point in the last 180 days: if there is no two-way touch for `settings.quiet_days` (default 90) and no open action of type `reengage`, raise `internal_relationship_quiet` (priority 2, lane not applicable, status confirmed) and create a `reengage` action. At most one quiet alert per person per 90 days.

### 11.6 Connections

**Derived nightly from roles** (weights are defaults in `settings.connections`):

| Rule | Type | Weight |
|---|---|---|
| Two people held board roles at the same company with an overlap of 6 months or more | `shared_board` | 0.80 |
| Two people held executive roles at the same company with overlap of 12 months or more, company `employee_count < 2000` or unknown, and at least one of them is C-suite | `overlapping_tenure` | 0.60 |
| As above, same `function` | `overlapping_tenure` | 0.70 (replaces 0.60) |
| One held a C-suite role and the other a board role at the same company with 12 months overlap | `shared_board` | 0.75 |

**Manual** (added on the person page): `reported_to` 0.90, `introduced_by` 0.70, `deal_counterpart` 0.60, `manual_other` 0.50.

Overlaps at companies with 2,000 or more employees are not derived: at that size, shared tenure is usually coincidence.

### 11.7 Warm path finder

For a target person T:

1. **Direct path**: firm-level score of T. If band is `strong` or `warm`, the direct path is returned first with strength `score / 100` and the owner who has the highest per-user score.
2. **One-hop paths**: for every connection C of T, the path is Us → C → T. Its strength is `min( our_score(C)/100, weight(C,T) )`. Only include C if our band with C is `warm` or `strong`, and C is not `do_not_contact`.
3. Return the top 3 paths by strength (ties broken by the more recent two-way touch with C). Two-hop paths are P2.

Each path returns: `{ kind: "direct" | "one_hop", strength, connector_person_id?, connection_type?, owner_user_id, explanation }`, where `explanation` is one sentence, for example "Partner has a warm relationship with Jane Roe, who sat on the Acme board with the target from 2019 to 2023."

A path with strength of 0.40 or more counts toward the "warm path" goal metric.

### 11.8 Coverage map

A grid of target-tier companies (rows) against seats (CEO, CFO, CHRO, COO, CTO or CIO, Chair, other board). Each cell shows the person in that seat and is tinted by firm-level band. Empty cells show "No one mapped". Clicking a cell opens the person or, if empty, the "Add person" form pre-filled with the company and seat.

---

## 12. Action layer

### 12.1 When actions are created

- On confirmation of any priority 1 or 2 signal whose subject resolves to a person who is `is_tracked` and not `do_not_contact`.
- For company signals, the action targets the person named in the signal if any; otherwise the most senior tracked person at the company with the strongest firm-level band; otherwise the action is created unassigned to a person with type `custom` and the headline "Find the right contact at <company>".
- On `internal_relationship_quiet`.
- Manually from any person page.
- Priority 3 signals do not create actions automatically; they appear in "Latest signals" with a "Create action" button.

### 12.2 Pre-action checks (block, do not draft)

Run in order; the first failure sets the action to `dismissed` with reason and a visible note, except where stated:

1. Person status `do_not_contact` or email suppressed: no action.
2. Consent: email channel `opted_out`: no email draft; LinkedIn draft still allowed if not opted out there.
3. EU or UK person (country in EU/EEA or GB) with email consent `unknown`: action created, draft blocked, note "Record a lawful basis before contacting this person". The data steward or partner can record `legitimate_interest` with a note.
4. Executive search pack: if the person's current employer has an active off-limits rule covering their function or seniority, and the action or draft would approach them as a candidate (`contact_types` includes only `potential_candidate`, or the chosen draft purpose is candidate), block with reason `off_limits`. Client approaches remain allowed.
5. An open action already exists for the same person created in the last 7 days: merge into it (append the new signal to the card) instead of creating a second one.

### 12.3 Action card contents

| Element | Source |
|---|---|
| Who and what changed | Person, new and previous role, signal headline, source links |
| Why it matters | Signal type default copy (section 9.3), plus any company signal in the last 30 days |
| Our position | Firm band and score, last two-way touch (channel and date), contact types, off-limits status |
| Best path | Top path from section 11.7 with its explanation |
| Suggested action | Default from signal type; editable |
| Draft | AI draft (section 17.3), editable in place |
| Owner and due date | Owner defaults to the partner; due date from SLA settings |
| Buttons | "Approve and send", "Save draft", "Mark done", "Dismiss" (reason required) |

### 12.4 Drafting and approval

- A draft is generated automatically when the action is created (unless blocked) and on request ("Redraft", with an optional instruction such as "shorter" or "mention the board appointment").
- Every draft follows the workspace style guide in `settings.style_guide` (default in section 20.3).
- Status flow: `open` → `drafted` → `awaiting_approval` (when an outreach owner submits it) → `approved` (partner) → `sent` → `done`. The partner can approve and send in one step.
- Editing a draft creates a new `drafts` version. The diff between the AI draft and the sent version is stored and summarised monthly into style guide suggestions the partner can accept (P1).

### 12.5 Sending

- Approved email drafts send from the partner's own mailbox through the connected provider (Microsoft Graph send permission; Gmail send scope for Google). The sent message is logged as an outbound interaction automatically.
- If the workspace uses CRM-based sending instead (setting `send.via = crm`), hand the approved draft to the CRM adapter.
- LinkedIn drafts are never sent by the platform. They are copied to the clipboard with one click and the user marks them sent; that creates a `linkedin_message` interaction.
- Sending is blocked if any pre-action check (12.2) fails at send time, not only at draft time.
- Rate limit: at most `settings.send.max_per_day` (default 25) platform-sent emails per mailbox per day.

### 12.6 Meeting briefs

For each calendar event in the next 20 to 26 hours with at least one tracked attendee, generate a one-page brief (section 17.3) and attach it to the event. Deliver it in the daily digest and as an email to the event owner 24 hours before the meeting. Briefs are also available on demand from the person page.

### 12.7 Dismissal and outcomes

- Dismiss requires a reason: `not_relevant`, `already_known`, `wrong_timing`, `off_limits`.
- For every sent action, 14 days after sending, prompt the owner in the digest to record the outcome: `no_reply`, `replied`, `meeting`, `mandate`. A reply detected by mail capture on the same conversation sets `replied` automatically; a calendar event with the person sets `meeting` automatically, both editable.

### 12.8 Service levels, alerts and digest

Defaults in `settings.sla` (editable):

| Item | Default |
|---|---|
| Priority 1 action due | 2 working days after signal confirmation |
| Priority 2 action due | 5 working days |
| `person_move_announced` | Due 2 working days before `effective_on`, or the priority 1 default if sooner |
| Escalation | Overdue by 1 working day: shown at the top of Today and in the digest |

| Alert | Channel | Timing |
|---|---|---|
| Daily digest | Email (Microsoft Teams webhook P1) | Workspace `digest_time`, default 08:00 |
| Priority 1 change on a strong or warm relationship | Email | Within 15 minutes of confirmation |
| Validation items older than 3 working days | Email to validators | In the digest |
| Meeting brief | Email to the event owner | 24 hours before the meeting |
| Auto-confirm suspended for a source | Email to partner and data steward | Immediately |
| AI or Apollo budget at 80% | Email to data steward and platform admin | Immediately |

**Digest content, in this order:** actions due today and overdue; drafts awaiting approval; priority 1 changes on strong or warm relationships since the last digest; meetings in the next 24 hours with links to briefs; going-quiet alerts; validation queue count and oldest item age (validators only); outcomes to record. Empty sections are omitted. If every section is empty, no digest is sent.

---

## 13. Executive search pack (workspace module)

Enabled per workspace with `packs.exec_search = true`. When off, every element in this section is hidden and its checks are skipped. The first workspace has it on.

| Requirement | Priority | Behaviour |
|---|---|---|
| Contact type | P0 | Multi-select on each person: prospective client, potential candidate, referrer, sponsor contact. Drafting uses the contact type: client-type drafts discuss the company's leadership needs; candidate-type drafts (only on explicit request) discuss the person's career. The two are never mixed in one message. |
| Off-limits rules | P0 | Partner-only screen to add rules per company (scope, function or minimum seniority, reason, start and end dates). A 30-day expiry reminder appears in the digest. The rule shows as a badge on the company and on every affected person. Enforcement in section 12.2 step 4. |
| Placements | P0 | CSV import and manual entry. Placed executives are a filter on People and always priority 1 on movement (section 7.3). A placed executive leaving creates two actions: a check-in with the person, and a check-in with the most senior tracked person at the company they left (possible backfill search). |
| Confidential mandate notes | P0 | Notes on a person or company visible only to the partner. Each view and export is written to the audit log. Never sent to the AI. |
| Succession watch | P0 | `company_ceo_tenure_threshold` signal (section 9.3); CFO or CHRO departures are priority 1 via `company_cxo_change`. |
| PE sponsor mapping | P2 | Schema at launch (`sponsor_links`, `companies.is_sponsor`, PE seat types). Sponsor pages and sponsor signals behind `pack.pe_mapping`. |

---

## 14. Content library and first-party engagement

- **Content library (P0):** the partner's thought papers, newsletter issues and interview clips, entered as `content_items` with title, URL, topics and date (form and CSV).
- **Topic vocabulary (P0):** a workspace-level list of topics (defaults: CEO succession, board composition, leadership transitions, PE portfolio leadership, CHRO agenda, CFO agenda, technology leadership). Newsletter links, content items and person interests all use it.
- **Suggestions:** when drafting `share_content`, `congratulate` or `reengage` actions, suggest the most recent content item whose topics overlap the person's interests or the signal's theme. The draft mentions it in one sentence; the partner can remove it.

---

## 15. CRM integration (P1)

- Adapter interface `CrmAdapter` with HubSpot as the first implementation (Markivis is a HubSpot partner, so this is the likeliest client CRM; confirm per section 25). Salesforce is P2.
- **Direction and ownership:** the CRM is the system of record for contacts, companies and logged activity; this tool is the system of record for signals, validation, provenance, scores and connections.
- **Sync out (every 15 min):** confirmed person and company changes (title, company, email, LinkedIn URL); interactions created here (as CRM activities or notes); relationship band and last two-way touch as custom properties; sent drafts as logged emails.
- **Sync in:** contacts and companies matching tracked records (matched by email, then domain); CRM-logged activities as interactions with `provider = crm`; unsubscribe and consent properties into `consents`.
- **Conflicts:** CRM edits to fields this tool also holds become `data_conflict` queue items; neither side overwrites silently.
- Read HubSpot's current API documentation for objects, associations, custom properties and rate limits before implementing; use a private app token stored per workspace.

---

## 16. User interface

All screens follow `BEAM_DESIGN_LANGUAGE.md`. This section defines what each screen contains; the design file defines how it looks. Every list screen has loading, empty, error and permission-denied states, each with specific copy. Every screen works at 360 px wide.

### 16.1 Navigation

App shell per design file section 7: top bar with the brand lockup, global search (people and companies, `/` to focus), workspace switcher (only when the user has more than one workspace), user menu. Primary navigation, in this order: **Today, Actions, Queue, People, Companies, Signals, Paths, Coverage, Settings**. Queue shows only to partner and validator; Settings shows only to partner and data steward. Each item with a count badge where it has one (Actions: due and overdue for the current user; Queue: pending items).

### 16.2 Screens

| Screen | Route | Purpose | Main content | Empty state copy |
|---|---|---|---|---|
| Today | `/` | What to do today | Panels in this order: My actions (due and overdue, drafts awaiting approval); Priority 1 changes on my relationships (last 7 days); Meetings in the next 24 hours with briefs; Going quiet; Validation queue summary (validators); Outcomes this month versus last; Data health (partner and steward). One readout band at the top per design file section 9.4: counts of actions due, awaiting approval, queue items, and oldest queue age. | "Nothing needs you today. New changes appear here as they are confirmed." |
| Actions | `/actions` | Work the action list | Filterable list (owner, status, priority, type, due); detail drawer with the full action card, draft editor, send controls, history | "No open actions. Confirmed changes create actions automatically." |
| Queue | `/queue` | Validate signals | Priority-ordered list with age; detail pane with claim, evidence quote, all sources with dates, confidence, proposed record changes as a before and after table, and decision controls; tabs for Review, Weekly batch, More research, Parked, Spot checks, Conflicts and duplicates | "The queue is clear." |
| People | `/people` | Find and manage people | Table: name, primary role, company, band, last two-way touch, contact types, flags (placed, off-limits, do not contact, off list); filters from section 16.3; "Add person"; CSV import | "No people yet. Import your target list or add a person." |
| Person | `/people/:id` | Everything about one person | Header with name, primary role, band chip, contact types, flags; tabs: Overview (roles timeline, current signals, open actions, best paths, interests with sources), Interactions (timeline), Connections (list; graph view P1), Signals, Record (every field with its sources and conflicts), Consent, Notes (partner only for confidential notes) | n/a |
| Companies | `/companies` | Find and manage companies | Table: name, tier, ownership, client status, seats mapped of seats tracked, strongest band, recent signal count | "No companies yet. Import your target list." |
| Company | `/companies/:id` | One company | Leadership and board with tenure and band per seat; signals timeline; off-limits rules; people; intent topics | n/a |
| Signals | `/signals` | All confirmed signals | Filterable feed with source links; "Create action" on priority 3 items | "No confirmed signals in this period." |
| Paths | `/paths` | Warm path finder | Search a person; ranked paths with strength, connector, explanation, owner and "Draft introduction request" | "Search for a person to see who can introduce you." |
| Coverage | `/coverage` | Seat coverage map | Grid per section 11.8, filter by tier, sector, ownership | "Add target companies to see coverage." |
| Settings | `/settings` | Configure the workspace | Members and roles; mailbox and calendar connections; feeds and sources (with health and reject rates); signal priorities with dismissal counts; scoring weights and calibration; SLAs and digest time; style guide; topics and content library; packs and flags (platform admin only for packs); consent and suppression; data export; audit log | n/a |

### 16.3 Filters available on People, Companies, Signals and Actions

Company, target tier, sector, ownership, seat type, contact type, owner, relationship band, source type, priority, status, date range, and the flags placed, off-limits, do not contact, off list. Filters are reflected in the URL so views can be bookmarked and shared.

### 16.4 Forms

- **Add or edit person:** name, LinkedIn URL, city, country, contact types, relationship owner; then one or more roles (company picker with "add company", title, seat type, email, dates); source note required for manual entries ("How do you know this?" with source type and optional URL).
- **Log interaction:** person, channel, date and time (default now), direction, summary, private toggle. Four fields visible; the rest under "More".
- **CSV imports:** target list (companies and people), placements, off-limits, content library, newsletter events. Each import shows a preview with row-level validation errors before committing, runs the matching rules in section 7.2, and reports created, matched, conflicts and rejected rows.

### 16.5 Interface copy rules

- US English, sentence case, plain verbs. Buttons say exactly what happens: "Approve and send", "Confirm change", "Reject", "Mark done".
- An action keeps one name through its flow: the button "Approve and send" produces the toast "Sent to <name>".
- Errors say what happened and how to fix it: "Couldn't send: the mailbox connection has expired. Reconnect it in Settings." Never "Something went wrong."
- Numbers carry units and dates use `Sep 29, 2026` in lists and relative time ("3 working days old") where age matters.
- No em dashes anywhere in interface copy.

---

## 17. AI usage

### 17.1 Provider and models

- Anthropic Messages API through an `AiAdapter` interface with `live` and `mock` implementations.
- Two model roles, configured by environment variable so they can change without code changes:
  - `AI_MODEL_FAST` for extraction and classification at volume. Default `claude-haiku-4-5-20251001`.
  - `AI_MODEL_WRITE` for drafts, briefs and research. Default `claude-sonnet-5-5`.
- Before implementing, read Anthropic's current models overview and API documentation to confirm model identifiers, structured output or tool-use syntax, and the web search tool, and log what you used in `DECISIONS.md`.
- All structured outputs are requested as JSON through tool use with an input schema (or the provider's structured output feature), then validated with Zod. A response that fails validation is retried once with the validation error included; a second failure sends the item to the review lane with the note "AI could not read this item".

### 17.2 Guardrails that apply to every call

- Send the minimum personal data needed. Never send email bodies (unless the partner opted a thread in), confidential mandate notes, consent proofs or suppression data.
- The model may only choose people and companies from the candidate IDs supplied; any ID not in the list is discarded.
- Drafts and briefs may state only facts present in the supplied context. The prompt says so, and a post-check rejects drafts containing a year, a number, a company name or a person name that does not appear in the context (flag for regeneration rather than silently editing).
- Every call writes an `ai_calls` row with purpose, model, prompt version, token counts, cost and latency. Prompts are versioned constants in code (`PROMPT_VERSION_EXTRACT = "extract.v1"` and so on) and the version is stored on each output.
- Budget: `settings.ai.monthly_budget_usd` (default 250, to be confirmed). At 80%, alert the data steward and platform admin. At 100%, pause automatic briefs, automatic drafts for priority 2 and research cycles; extraction and priority 1 drafts continue; resume automatically on the first of the month.

### 17.3 Prompt contracts

**`extract_signal`** (model: fast; temperature 0)

Input: raw item title, body text (truncated to 12,000 characters), source type, published date, and the candidate list `[{ id, kind: "person"|"company", name, aliases, company_name, title }]`.

Output schema:

```json
{
  "is_relevant": true,
  "signal_type": "person_joined",
  "subject_kind": "person",
  "person_candidate_id": "uuid or null",
  "company_candidate_id": "uuid or null",
  "match_confidence": 0.93,
  "new_title": "Chief Financial Officer or null",
  "previous_title": "string or null",
  "event_date": "YYYY-MM-DD or null",
  "announced_date": "YYYY-MM-DD or null",
  "effective_date": "YYYY-MM-DD or null",
  "headline": "string, 140 characters maximum, no speculation",
  "evidence_quote": "verbatim quote from the text, 300 characters maximum"
}
```

System prompt essentials: classify only into the listed signal types; if the text does not clearly describe a change about a candidate, return `is_relevant: false`; the evidence quote must be verbatim from the input; never infer a person's employer or title that the text does not state.

**`draft_message`** (model: write; temperature 0.4)

Input: partner name and style guide; person (preferred name, current role, company, contact types, country); the signal headline, type, dates and one source title; suggested action; best path (if one hop, the connector's name and connection explanation); last three interactions as metadata only (channel, date, direction, subject if permitted); relationship band; one suggested content item (title, one-line description, URL); channel (`email` or `linkedin_message`); optional user instruction.

Output schema:

```json
{
  "subject": "string or null for LinkedIn",
  "body": "string",
  "used_content_item": true,
  "rationale": "one sentence for the approver: why this angle"
}
```

Rules in the prompt: follow the style guide; one clear, low-pressure ask; never claim a shared history that is not in the interaction list; never mention how the change was detected; for introduction requests, write to the connector, not the target.

**`meeting_brief`** (model: write; temperature 0.2)

Input: person, roles history, current and last-90-day signals for the person and their company, interaction timeline (metadata), band and factors, best paths, known interests with sources, content already sent, open actions.

Output: markdown with exactly these headings, each at most 80 words: `Who they are`, `What changed recently`, `Our history`, `What they care about`, `Mutual connections`, `Open items`, `Suggested talking points` (three bullets). A missing section says "Nothing on record."

**`research_more`** (model: write; web search tool when `AI_WEB_SEARCH=true`, otherwise skipped and the item returns to review with the note "Research is disabled")

Input: the pending signal and its sources. Task: find up to three independent sources that confirm or contradict the claim, published within 30 days of the event. Output:

```json
{
  "verdict": "confirms | contradicts | inconclusive",
  "sources": [{ "url": "string", "title": "string", "published_date": "YYYY-MM-DD or null", "supports": true }],
  "note": "one sentence for the validator"
}
```

Found sources are added to `signal_sources` with `source_type = ai_research`; confidence is recomputed; the signal returns to review. The AI never confirms a signal.

### 17.4 Mock mode

When `DATA_MODE=mock` or no `ANTHROPIC_API_KEY` is present, `AiAdapter` returns deterministic outputs: extraction reads `/fixtures/ai/extract/<raw_item_external_id>.json`; drafts and briefs render from templates filled with the supplied context, prefixed "[Mock draft]". The interface shows a small "Mock data" badge in the top bar whenever any adapter is in mock mode.

---

## 18. Compliance, privacy and security

The requirements below must be confirmed by the client's counsel before launch; they are not legal advice. Build the mechanisms regardless.

### 18.1 Outreach and consent

- Consent is recorded per person, channel and purpose, with jurisdiction and proof (section 6.6).
- US contacts: commercial email practice follows CAN-SPAM, including honouring opt-outs within 10 business days; this system applies opt-outs immediately.
- EU, EEA and UK contacts: drafting and sending are blocked until a lawful basis is recorded (section 12.2 step 3). The newsletter requires `opted_in`.
- A global do-not-contact status and the suppression list override every other rule, including CSV imports and all adapters.

### 18.2 Data subject requests

- **Access:** the data steward can export everything held about one person (all tables, all field sources, all interactions) as JSON and CSV in one click.
- **Erasure:** deletes the person, their roles, interactions, signals, actions, drafts, briefs, consents and field sources; removes them from CRM sync with a delete instruction where the CRM adapter supports it; writes a suppression hash for each known email and LinkedIn URL; writes an audit entry that records the request without personal data. Erasure must complete within one job run and be verifiable by a test.
- **Retention review:** monthly list of people with `no_current_role` and no interaction for 24 months, for the data steward to keep or erase.

### 18.3 Security

- Tenancy isolation per section 5.1, proved by tests.
- Encryption in transit (TLS 1.2 or later) and at rest (database or disk encryption at the host; OAuth tokens and workspace secrets additionally encrypted with envelope encryption).
- Secrets only in environment variables or a secrets manager; never in the repository. Per-workspace credentials (Apollo key, HubSpot token, newsletter API key) are stored in a `workspace_secrets` table (`kind`, `ciphertext`, `key_id`) and are write-only in the interface.
- Content Security Policy that allows only the app's origin plus the Google Fonts origins required by the design file.
- Audit log for: sign-in, role changes, merges and unmerges, validation decisions, draft approvals and sends, off-limits changes, consent and suppression changes, exports, erasures, confidential note views, settings changes, platform admin break-glass access.
- Dependency scanning in CI; no dependency with a known critical vulnerability at launch.
- Bulk export limited to the data steward; every export is audited.

### 18.4 Ownership and exit

The client owns its workspace data and configuration. Markivis acts as processor. The data steward can export the full workspace (every table, CSV and JSON, plus a schema description) at any time, and the export must complete for 50,000 people within 30 minutes.

### 18.5 Source licensing

Each field records its source, so data from a licence that ends can be removed by source type. Before live use, confirm that Apollo's terms (and any wire's feed terms) permit storing the data in this system; record the confirmation in `DECISIONS.md` and in the feed's configuration.

---

## 19. Non-functional requirements

| Area | Requirement |
|---|---|
| Scale | 500 target companies and 10,000 people per workspace at launch; 2,000 companies and 50,000 people per workspace without redesign; 20 workspaces per deployment |
| Freshness | Per schedule in section 8.9 |
| Speed | Person and company pages: server response under 500 ms at p95 with 50,000 people; full page interactive under 2 s on a mid-range laptop. Search under 300 ms at p95 |
| Pipeline throughput | 2,000 raw items per hour per worker |
| Availability | 99.5% during US business hours; maintenance outside them |
| Idempotency | Every job can run twice without duplicate records (enforced by unique external IDs and dedupe keys) |
| Auditability | Every field change records who, when, old value, new value and source |
| Explainability | Every score, priority, lane and suggested action shows the inputs behind it |
| Portability | Data model maps to HubSpot or Salesforce objects without loss; no business logic in the database beyond constraints and row-level security |
| Recovery | Daily backups kept 30 days; point-in-time recovery if the host supports it; restore procedure documented and tested before launch |
| Observability | Structured JSON logs with request and job IDs; job failure and adapter health metrics; alert when any adapter fails 3 runs in a row |
| Accessibility | WCAG 2.1 AA; automated axe checks with zero serious or critical violations on every screen; full keyboard operation of the queue and action flows |
| Browser support | Current and previous major versions of Chrome, Edge, Safari and Firefox; mobile Safari and Chrome at 360 px |
| Cost control | Apollo credits and AI spend tracked per workspace with monthly caps (sections 8.1 and 17.2) |

---

## 20. Configuration

### 20.1 Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection |
| `APP_URL` | Yes | Public origin, for example `https://beam.markivis.com` |
| `APP_BASE_PATH` | Yes | Default `/intelligence` |
| `DATA_MODE` | Yes | `live`, `mock` or `record` |
| `AUTH_SECRET` | Yes (fallback auth) | Session signing |
| `AUTH_MICROSOFT_CLIENT_ID`, `AUTH_MICROSOFT_CLIENT_SECRET`, `AUTH_MICROSOFT_TENANT` | For Microsoft sign-in and capture | Entra ID app registration |
| `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET` | For Google sign-in and capture | |
| `TOKEN_ENCRYPTION_KEY` or `KMS_KEY_ID` | Yes | Envelope encryption for tokens and workspace secrets |
| `ANTHROPIC_API_KEY` | For live AI | |
| `AI_MODEL_FAST` | No | Default `claude-haiku-4-5-20251001` |
| `AI_MODEL_WRITE` | No | Default `claude-sonnet-5-5` |
| `AI_WEB_SEARCH` | No | `true` enables the research step |
| `SEC_USER_AGENT` | For live SEC | Descriptive user agent with a contact email, per SEC guidance |
| `SMTP_URL` or transactional email provider key | Yes | Digest, alerts and briefs |
| `MAIL_FROM` | Yes | For example `BEAM Intelligence <intelligence@beam.markivis.com>` |
| `TEAMS_WEBHOOK_URL` | No | P1 |
| `LOG_LEVEL` | No | Default `info` |
| `ERROR_TRACKING_DSN` | No | Error tracking |

### 20.2 Per-workspace secrets

Stored in `workspace_secrets`: `apollo_api_key`, `hubspot_private_app_token`, `newsletter_api_key`.

### 20.3 Default workspace settings

```json
{
  "digest_time": "08:00",
  "working_days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
  "sla": { "p1_working_days": 2, "p2_working_days": 5, "announced_lead_working_days": 2 },
  "scoring": {
    "weights": { "recency": 0.30, "frequency": 0.25, "reciprocity": 0.20, "depth": 0.15, "tenure": 0.10 },
    "recency_half_scale_days": 90,
    "bands": { "strong": 70, "warm": 45, "cooling": 25, "cold": 1 }
  },
  "quiet_days": 90,
  "ceo_tenure_years": 7,
  "connections": { "max_company_size": 2000, "board_overlap_months": 6, "exec_overlap_months": 12 },
  "validation": { "spot_check_share": 0.10, "spot_check_min": 5, "suspend_error_rate": 0.02, "feed_reject_flag_rate": 0.50 },
  "send": { "via": "mailbox", "max_per_day": 25 },
  "apollo": { "monthly_credit_cap": null },
  "ai": { "monthly_budget_usd": 250 },
  "validator_hours_per_week": 5,
  "reputable_outlets": [],
  "style_guide": "Write as the partner, in the first person, in formal but warm American business English. Email: 120 words maximum. LinkedIn: 60 words maximum. Open with the specific reason for writing. Refer only to facts provided. No flattery or filler (for example 'I hope this finds you well', 'thrilled', 'exciting'). No exclamation marks. End with one clear, low-pressure ask. Sign off with the partner's first name."
}
```

Values marked as defaults are proposals to be confirmed with the client; the partner can change them in Settings.

---

## 21. Seed data, fixtures and mock mode

The product must run fully on a fresh laptop with `docker compose up` and `DATA_MODE=mock`.

**Seed workspace:** "Demo Search Partners" with the executive search pack on. All names, companies, emails and domains are fictional and use reserved domains (`example.com`, `example.org`, `example.net` and subdomains). No real person or company appears anywhere in seed data or fixtures.

| Seed content | Quantity |
|---|---|
| Users | 4: partner, outreach owner, validator, data steward (sign-in bypass available only in mock mode) |
| Companies | 40: 15 public (fictional CIKs prefixed `99`), 12 PE-backed, 8 private, 3 PE sponsors, 2 clients |
| People | 150 with 220 roles, including 12 board members holding two or more concurrent seats, 6 people with no LinkedIn URL, 5 placements |
| Interactions | 600 across 12 months, shaped so the score bands are all represented |
| Connections | Derived by the nightly job from the seeded roles |
| Off-limits rules | 2 (one company-wide, one function-level) |
| Content items | 8 |
| Calendar events | 3 tomorrow with tracked attendees (for briefs) |

**Fixtures per adapter** under `/fixtures/<adapter>/`: 10 SEC 8-K Item 5.02 filings (fictional text), 20 wire RSS items (mix of relevant, irrelevant and duplicate stories), 15 Google Alerts items (including two false name matches), 4 leadership page before-and-after pairs, Apollo enrichment responses for 30 people including 3 job changes and 2 guessed emails, Graph mail delta pages and calendar events, a newsletter CSV with clicks and one unsubscribe, and AI extraction outputs for every raw item. Together they must produce at least one signal in each lane, one merge, one conflict, one possible duplicate, one off-limits block, one EU consent block and one going-quiet alert.

A command `npm run demo:reset` (or the equivalent in the detected stack) rebuilds the seed workspace from scratch.

---

## 22. Testing and acceptance

### 22.1 Test layers

- **Unit:** matching rules, dedupe keys, confidence, lane assignment, scoring formula, band thresholds, connection derivation, path ranking, pre-action checks, SLA due dates across weekends, suppression hashing.
- **Integration:** each adapter against its fixtures; the full pipeline from raw item to action; erasure end to end; export; tenancy isolation across every API route (generated test that calls every route as a user of another workspace and expects 403 or 404).
- **End to end (Playwright):** the flows in 22.2 in mock mode.
- **Accessibility:** axe on every screen; keyboard-only run of the queue and the action flow.

### 22.2 Acceptance scenarios (all must pass for launch)

1. **SEC auto-confirm.** Given a tracked public company and an 8-K Item 5.02 fixture naming a tracked CFO's departure, when the pipeline runs, then a `person_left` signal is confirmed without human review, the role is ended, and a priority 1 `check_in` action with a draft is due in 2 working days.
2. **Wire duplicates merge.** Given three wire items describing the same appointment, when processed, then one signal exists with three sources and confidence `high`.
3. **False name match stays out.** Given a Google Alert about a different person with the same name as a tracked executive and no tracked company in the text, when processed, then no signal is created and the raw item outcome is `irrelevant`.
4. **Possible duplicate never auto-merges.** Given an import row with the same name and city as an existing person but no email or LinkedIn match, then a `possible_duplicate` queue item is created and no merge happens.
5. **Board seats coexist.** Given a person with two current board roles, when one board exit is confirmed, then the person stays `active` and the other role remains current.
6. **Announced move.** Given an announcement with an effective date 30 days ahead, then the role is `announced`, a priority 1 action is due 2 working days before the effective date, and on the effective date the role becomes `current`.
7. **Validator flow.** Given a pending priority 2 signal, when the validator presses `r` and chooses `wrong_person`, then the signal is rejected, the reason is stored, and the feed's weekly reject count increases.
8. **Research loop limit.** Given a signal sent to more research twice, then the "More research" control is disabled and only confirm, reject and park remain.
9. **Weekly batch.** Given 12 priority 3 items in the batch with one unticked, when approved, then 11 are confirmed and one remains pending.
10. **Spot-check suspension.** Given a week where 1 of 5 spot-checked SEC auto-confirmations is marked incorrect, then auto-confirm is suspended for `sec_8k` in that workspace and the partner sees the notice.
11. **Mail capture scope.** Given a mailbox delta with 50 messages of which 4 involve tracked people, then exactly 4 interactions are created and no metadata from the other 46 is stored.
12. **Private thread.** Given a thread marked private by the partner, then an outreach owner sees the interaction count but not the subject.
13. **Score and band.** Given the seeded interactions for a named demo person, then the stored score matches the formula in 11.4 to the integer and the band matches the thresholds.
14. **Going quiet.** Given a priority person with a warm band 120 days ago and no two-way touch for 91 days, then one `internal_relationship_quiet` signal and one `reengage` action are created, and none again for 90 days.
15. **Warm path.** Given a target with no direct relationship and a connector who shared a board with them and has a strong band with the partner, then the Paths screen shows that one-hop path first with its explanation.
16. **Off-limits block.** Given an active company-wide off-limits rule, when a candidate-type draft is requested for an executive there, then drafting is blocked with the off-limits reason; a client-type check-in is still allowed.
17. **EU consent block.** Given a person in Germany with email consent `unknown`, then the action is created but drafting and sending are blocked until a lawful basis is recorded.
18. **Approval and send.** Given an outreach owner submits a draft, when the partner approves it, then it is sent from the partner's mailbox (mock provider), an outbound interaction is logged, and the action becomes `sent`.
19. **Reply detection.** Given a sent message, when mail capture sees a reply in the same conversation, then the action outcome becomes `replied`.
20. **Meeting brief.** Given a calendar event tomorrow with a tracked attendee, when the hourly job runs, then a brief with all seven headings exists and appears in the digest.
21. **Digest.** Given no actions, drafts, changes, meetings or quiet alerts for a user, then no digest is sent to that user.
22. **Erasure.** Given an erasure request for a person, then all their rows are deleted, a suppression hash exists, and a later Apollo fixture containing their email creates nothing.
23. **Tenancy.** Given two workspaces, then no API route returns any row from the other workspace to a user of the first.
24. **Mock mode.** On a fresh clone, `docker compose up` with `DATA_MODE=mock` brings up a working seeded product with every screen populated and the "Mock data" badge visible.
25. **Accessibility.** axe reports zero serious or critical violations on every screen; the queue can be worked end to end with the keyboard only.

---

## 23. Build order

One launch, built in this order. Each milestone ends with its tests passing and a short entry in `DECISIONS.md`.

| Milestone | Scope | Definition of done |
|---|---|---|
| M0 Orientation | Repository detection (3.3), stack decision, CI, Docker, design tokens and app shell from the design file | App shell renders at 360 px and 1440 px with the brand lockup; CI runs lint, type-check and tests |
| M1 Foundations | Tenancy, auth (or BEAM auth), roles, audit log, full schema and migrations, seed data | Tenancy isolation test passes; seed workspace loads |
| M2 Records | People, companies, roles, field sources, manual entry, CSV imports, matching rules | Scenarios 4 and 5 pass |
| M3 Ingestion | All P0 adapters with mock and live implementations; job scheduler | Each adapter's fixture test passes; live health checks implemented |
| M4 Pipeline and validation | Pre-filter, AI extraction, resolve, dedupe, confidence, priority, lanes, queue, batch, research, spot checks, stats | Scenarios 1 to 3 and 7 to 10 pass |
| M5 Actions | Action creation, pre-action checks, drafting, approval, Today, Actions, digest, SLAs | Scenarios 16, 17 and 21 pass |
| M6 Executive search pack | Contact types, off-limits, placements, confidential notes, succession watch | Pack toggles cleanly on and off |
| M7 Capture | Microsoft 365 mail and calendar; Google (P1); privacy controls | Scenarios 11 and 12 pass |
| M8 Relationships | Scoring, calibration screen, going quiet, connections, paths, coverage | Scenarios 13 to 15 pass |
| M9 Outputs and sync | Briefs, sending from mailbox, reply detection, outcomes; HubSpot sync (P1) | Scenarios 18 to 20 pass |
| M10 Compliance and hardening | Consent, suppression, erasure, export, retention review, security headers, performance, accessibility pass | Scenarios 22 to 25 pass; NFR checks in section 19 met |

---

## 24. Launch readiness

### 24.1 Shadow run (replaces the original Release 1 to Release 2 gate)

Run all live ingestion for 14 days on 20 to 30 pilot accounts before any user other than validators and the platform admin sees signals. Signals are created with status `shadow`, visible in a "Shadow" tab of the queue. Produce a report: raw items per week, signals per week by lane and priority, auto-confirm share, reject share by feed, and projected validator minutes per week (review items at 1.5 minutes each, batch items at 0.25 minutes each).

**Go criterion:** projected weekly review time is at or below `validator_hours_per_week`. If not, tighten feeds (filters, removal of noisy alerts) and rerun for 7 days. Log the result in `DECISIONS.md`.

At go-live, shadow signals from the last 7 days are promoted into their normal lanes; older ones are discarded.

### 24.2 Non-code prerequisites (owner: Markivis and the client)

- [ ] Microsoft Entra ID app registration for sign-in, mail metadata, calendar read and mail send; admin consent granted in the client's tenant
- [ ] Google OAuth client and any required verification, if the client uses Google Workspace
- [ ] Client's Apollo API key with confirmed plan limits and terms
- [ ] SEC user agent contact email
- [ ] Reverse proxy route for `/intelligence` on `beam.markivis.com`
- [ ] Sending domain for digests and alerts with SPF, DKIM and DMARC
- [ ] Data processing agreement signed between Markivis and the client
- [ ] Partner's style guide and three example emails he considers good
- [ ] Target list CSV, placements CSV, off-limits CSV and content library
- [ ] Named validator with agreed weekly hours
- [ ] Scoring calibration session with the partner (section 11.4)
- [ ] Client counsel sign-off on consent handling (section 18)

### 24.3 Launch checklist

- [ ] All acceptance scenarios in 22.2 pass in CI
- [ ] Shadow run go criterion met
- [ ] Backup restore tested
- [ ] Every adapter reports healthy in live mode
- [ ] AI and Apollo budget alerts tested
- [ ] Mock badge absent in production

---

## 25. Open questions with defaults

| # | Question | Who answers | Blocking | Default if unanswered |
|---|---|---|---|---|
| 1 | Is the first workspace the US executive search partner? | Amit | No | Yes; executive search pack on |
| 2 | Does the client use an executive search system (Thrive TRM, Clockwork, Invenias, FileFinder)? If so, is it the system of record? | Client | No | None in use; placements and off-limits come from CSV |
| 3 | Microsoft 365 or Google Workspace? | Client IT | No | Microsoft 365 first; Google as P1 |
| 4 | Will the partner and client IT approve mail metadata and calendar access? | Partner, client IT | **Blocking for go-live only** | Build it; if refused, switch off `capture.*` flags and rely on manual logging |
| 5 | Which CRM, which tier, what API access? | Client | No | HubSpot adapter as P1; if none, the platform sends via mailbox and is the record of interactions |
| 6 | How many companies and people at launch and in 12 months? | Client | No | 500 companies, 10,000 people |
| 7 | Which seats count? | Partner | No | C-suite and board; VP and SVP tracked only when added manually |
| 8 | Which Apollo plan, and does it include API access, job-change alerts and intent topics? | Client | No | API access yes; job-change via weekly re-enrichment diff; intent if available |
| 9 | Any EU or UK targets? | Partner | No | Handle as specified; block until a lawful basis is recorded |
| 10 | Who validates, and how many hours a week? | Markivis | No | One validator, 5 hours a week |
| 11 | Can priority 3 items be batch-approved? | Partner | No | Yes |
| 12 | Monthly AI budget per workspace? | Amit | No | USD 250 |
| 13 | Product name and route inside BEAM? | Amit | No | "Decision-Maker Intelligence" at `/intelligence` |
| 14 | Hosting target? | Markivis | No | Docker images deployable to any container host; document the chosen host in `DECISIONS.md` |
| 15 | Who owns the platform and data at the end of the engagement? | Amit and client | No | Client owns data; full export available at any time |

---

## 26. Glossary

| Term | Meaning |
|---|---|
| Person | One human being; the anchor for all history |
| Role | One seat a person holds at one organisation for one period |
| Signal | A detected change about a person or company, with sources |
| Primary source | An SEC filing, the company's own release or website, or its leadership page |
| Lane | The path a signal takes to confirmation: auto-confirm, review, weekly batch, more research |
| Band | The relationship strength label: strong, warm, cooling, cold, none |
| Two-way touch | A conversation with messages in both directions within 30 days, or a meeting or call |
| Warm path | A route to a person through a direct relationship or one connector |
| Off-limits | A rule that stops candidate approaches to executives at a client or recent placement company |
| Shadow run | Live ingestion with signals hidden from all but validators, used to size the workload before launch |
| Pack | A per-workspace module, such as the executive search pack |
