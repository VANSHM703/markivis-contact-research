# BEAM Decision-Maker Intelligence

Relationship intelligence inside BEAM: one trusted record of every senior decision-maker at a client's target companies, the changes that matter about them, and a drafted next action for each.

- Build specification: [`DMI_BRD_for_Claude_Code.md`](DMI_BRD_for_Claude_Code.md)
- Visual and UI rules: [`BEAM_DESIGN_LANGUAGE.md`](BEAM_DESIGN_LANGUAGE.md)
- Choices made during the build: [`DECISIONS.md`](DECISIONS.md)

## Status

| Milestone | State |
|---|---|
| M0 Orientation: stack, CI, Docker, design tokens, app shell | Done |
| M1 Foundations: tenancy, auth, roles, audit log, schema, seed data | Done |
| M2 Records: people, companies, roles, field sources, manual entry, CSV imports, matching | Done |
| M3 Ingestion: source adapters and the job scheduler | Done |
| M4 Pipeline and validation: extraction, matching, dedupe, confidence, lanes, the queue | Done |
| M5 Actions: action cards, pre-action checks, drafting, approval, Today, digest, service levels | Next |
| M6 to M10 | Not started |

## Run it locally

Requires Node 20.9 or later and PostgreSQL 16.

```bash
brew install postgresql@16 && brew services start postgresql@16
psql -d postgres -f db/bootstrap.sql   # roles dmi, dmi_app, dmi_system; databases dmi, dmi_test, dmi_e2e
cp .env.example .env                   # then set AUTH_SECRET
npm install
npm run demo:reset                     # migrate from scratch and load the demo workspaces
npm run dev                            # the web app
npm run worker                         # in a second terminal: queued jobs and the schedule
```

Open http://localhost:3000/intelligence. In mock mode (`DATA_MODE=mock`, the default) the sign-in page lists the demo users, and a "Mock data" badge shows in the top bar. Every name, company and email in the demo data is fictional.

| Demo user | Role |
|---|---|
| Jordan Ellis | Partner, Demo Search Partners |
| Priya Raman | Outreach owner, Demo Search Partners |
| Sam Okafor | Validator, in both workspaces (shows the workspace switcher) |
| Lee Whitford | Data steward, Demo Search Partners |
| Casey Morgan | Partner, Harbor Search Group |

With Docker:

```bash
docker compose up
```

## Checks

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript, strict
npm test            # Vitest: unit tests, plus integration tests against dmi_test (tenancy, seed, sign-in)
npm run test:e2e    # Playwright against dmi_e2e: sign-in, layout at 320 to 1440 px, workspace switching, axe
```

CI runs all of these on every push and pull request (`.github/workflows/ci.yml`).

## Importing a target list

People, then "Import target list". Download the template from that page for the columns (only `company_name` is required). The preview shows what will happen to every row before anything is saved; possible duplicates and conflicting values go to Queue, under "Conflicts and duplicates".

## The pipeline and the queue

Collected items go through the pipeline (BRD 9): a name match, AI extraction, matching to tracked people and companies, merging of duplicate reports, confidence, priority and a lane. Clear primary-source changes are confirmed automatically; the rest wait in Queue, where a validator confirms, rejects, sends for research or parks each one, with keyboard shortcuts (press `?` in the queue). In mock mode the AI reads fixtures under `fixtures/ai/`; set `ANTHROPIC_API_KEY` and `DATA_MODE=live` for the real models.

## Sources

Settings, Sources shows every source's health and lets you check a connection or run it now (the worker must be running). In mock mode every source reads the fictional fixtures under `fixtures/`; regenerate them with `npm run fixtures:generate` after changing the seed. Each adapter's README, under `src/ingest/adapters/`, describes its behaviour and links the provider documentation it follows.

Going live needs, per workspace: the client's Apollo API key (entered in Settings, Sources), and for the deployment `SEC_USER_AGENT` (organization name and a contact email) and `TOKEN_ENCRYPTION_KEY`.

## Configuration

Copy `.env.example` to `.env`. The full list of variables is in BRD section 20.1. The app is served under `APP_BASE_PATH` (default `/intelligence`) so it can sit behind the BEAM reverse proxy.

## Layout

```
db/
  bootstrap.sql   database roles and databases (run once per cluster, as a superuser)
  migrations/     generated schema plus the hand-written row-level security migration
fixtures/         mock-mode data for every adapter, generated from the seed
scripts/          migrate, setup (compose), demo:reset, generate-fixtures
src/
  app/            (app) signed-in routes, (auth) sign-in, api/v1 JSON routes
  db/             schema, scoped query layer, seed generator
  domain/         matching, provenance, records, merge, suppression, titles, CSV imports, secrets
  ai/             AI adapter (Anthropic Messages API, and a mock), prompt contracts, budget
  pipeline/       pre-filter, extraction, resolve, dedupe, confidence, priority, lanes, validation
  ingest/         source adapters (SEC, wires, alerts, pages, Apollo, newsletter), transports, run loop
  jobs/           pg-boss queue, schedule (BRD 8.9), handlers
  worker/         the worker process
  components/
    shell/        top bar, brand lockup, sidebar, mobile drawer, search, user menu
    ui/           page header, empty state, readout band
  config/         product name, base path, DATA_MODE, navigation
  lib/            auth, request context, identity, permissions, audit, normalisation
  server/         read queries and server actions
  styles/         tokens.css (verbatim from the design file), globals.css
tests/
  unit/           Vitest
  e2e/            Playwright
```
