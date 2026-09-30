# BEAM Decision-Maker Intelligence

Relationship intelligence inside BEAM: one trusted record of every senior decision-maker at a client's target companies, the changes that matter about them, and a drafted next action for each.

- Build specification: [`DMI_BRD_for_Claude_Code.md`](DMI_BRD_for_Claude_Code.md)
- Visual and UI rules: [`BEAM_DESIGN_LANGUAGE.md`](BEAM_DESIGN_LANGUAGE.md)
- Choices made during the build: [`DECISIONS.md`](DECISIONS.md)

## Status

| Milestone | State |
|---|---|
| M0 Orientation: stack, CI, Docker, design tokens, app shell | Done |
| M1 Foundations: tenancy, auth, roles, audit log, schema, seed data | Next |
| M2 to M10 | Not started |

## Run it locally

Requires Node 20.9 or later.

```bash
npm install
npm run dev
```

Open http://localhost:3000/intelligence. The app runs in mock mode (`DATA_MODE=mock`) by default, with a "Mock data" badge in the top bar.

With Docker:

```bash
docker compose up
```

## Checks

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript, strict
npm test            # Vitest unit tests
npm run test:e2e    # Playwright: layout at 320 to 1440 px, navigation, axe accessibility
```

CI runs all of these on every push and pull request (`.github/workflows/ci.yml`).

## Configuration

Copy `.env.example` to `.env`. The full list of variables is in BRD section 20.1. The app is served under `APP_BASE_PATH` (default `/intelligence`) so it can sit behind the BEAM reverse proxy.

## Layout

```
src/
  app/            routes (Today, Actions, Queue, People, Companies, Signals, Paths, Coverage, Settings)
  components/
    shell/        top bar, brand lockup, sidebar, mobile drawer, search, user menu
    ui/           page header, empty state, readout band
  config/         product name, base path, DATA_MODE, navigation
  lib/            session (placeholder until M1)
  styles/         tokens.css (verbatim from the design file), globals.css
tests/
  unit/           Vitest
  e2e/            Playwright
```
