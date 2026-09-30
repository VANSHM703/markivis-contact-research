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
| M2 Records: people, companies, roles, field sources, manual entry, CSV imports, matching | Next |
| M3 to M10 | Not started |

## Run it locally

Requires Node 20.9 or later and PostgreSQL 16.

```bash
brew install postgresql@16 && brew services start postgresql@16
psql -d postgres -f db/bootstrap.sql   # roles dmi, dmi_app, dmi_system; databases dmi, dmi_test, dmi_e2e
cp .env.example .env                   # then set AUTH_SECRET
npm install
npm run demo:reset                     # migrate from scratch and load the demo workspaces
npm run dev
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

## Configuration

Copy `.env.example` to `.env`. The full list of variables is in BRD section 20.1. The app is served under `APP_BASE_PATH` (default `/intelligence`) so it can sit behind the BEAM reverse proxy.

## Layout

```
db/
  bootstrap.sql   database roles and databases (run once per cluster, as a superuser)
  migrations/     generated schema plus the hand-written row-level security migration
scripts/          migrate, setup (compose), demo:reset
src/
  app/            (app) signed-in routes, (auth) sign-in, api/v1 JSON routes
  db/             schema, scoped query layer, seed generator
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
