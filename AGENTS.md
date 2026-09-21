# Repository Guidelines

## Project Overview

Bellwatch is a scheduled Node.js/TypeScript service that monitors Irish property listings on Daft.ie. It parses listings and detail pages, applies search and Starter Home Purchase Scheme (SHPS/LAAPS) filters, compares sale prices with historical sold-property data, persists seen-listing state, and sends alerts through Shoutrrr and/or signed Hermes webhooks.

## Architecture & Data Flow

1. `src/main.ts` parses environment configuration, opens the state store, installs runtime metrics, and runs the polling cycle on an Effect cron schedule. Shutdown signals close state and metrics resources deterministically.
2. `src/monitor.ts` orchestrates each poll: build Daft URLs, fetch pages, hydrate details when required, apply SHPS filters, enrich sale findings with sold comparables, deduplicate against persistent state, publish notifications, and write the heartbeat.
3. `src/browser.ts` owns browser/page retrieval. Daft requests must pass robots.txt checks (`src/daft/robots.ts`) and the shared request-rate gate. Payloads come from Next.js `#__NEXT_DATA__`, using local Chromium or an external CDP endpoint.
4. `src/daft/` contains pure-ish URL, filter, robots, JSON, section, listing-parser, SHPS, and sold-comparison logic. Keep parsing and URL construction separate from browser/network I/O.
5. `src/state.ts` persists `seen_listings` and `monitor_state` through SQLite or PostgreSQL. First-run seeding and notification ordering are part of the behavioral contract.
6. `src/notifications.ts` coordinates backends. `src/shoutrrr.ts` runs the external Shoutrrr CLI; `src/hermes.ts` signs webhook requests with HMAC-SHA256 and retries transient failures.
7. `src/healthcheck.ts` validates heartbeat freshness. The container also reports runtime metrics from `src/runtime-metrics.ts`.

Preserve the explicit dependency seams (`MonitorDependencies`, injected runners/transports, and state abstractions). They are the primary testability mechanism.

## Key Directories

- `src/`: production TypeScript.
  - `src/daft/`: Daft URL/filter/payload/parser/robots/SHPS/sold modules.
  - `src/monitor.ts`, `src/state.ts`, `src/notifications.ts`: orchestration, persistence, and delivery.
- `test/`: Node test-runner suites named `<feature>.test.ts`; helpers and realistic in-memory Daft payloads live beside the tests.
- `scripts/`: test bundling, changed-file validation, fixture E2E, and live Daft E2E runners.
- `.github/workflows/`: PR validation, master push validation, image publishing, and Dependabot policy.
- `Dockerfile`, `docker-compose.yml`, `alchemy.run.ts`: container packaging, local/remote Compose operation, and Alchemy deployment.

## Development Commands

Initial setup:

```bash
npm cache verify
npm ci --ignore-scripts
npm run prepare
```

Common checks:

```bash
npm run lint
npm run typecheck
npm run build
npm test
npm run coverage
npm run check                 # lint + typecheck + build + coverage
npm run check:changed -- origin/master HEAD
npm run security:local
```

Mutation testing:

```bash
npm run mutation              # full configured Stryker scope; potentially slow
```

Container acceptance tests on macOS:

```bash
container system start
container build -t bellwatch:e2e .
CONTAINER_CLI=container E2E_IMAGE=bellwatch:e2e npm run e2e
CONTAINER_CLI=container E2E_IMAGE=bellwatch:e2e npm run e2e:live
```

The fixture E2E uses local canned Daft payloads and a mock sink. The live E2E reaches `https://www.daft.ie`, validates real `__NEXT_DATA__`, checks the signed Hermes payload, and runs the production healthcheck. Pass `E2E_IMAGE` explicitly because the fixture and live scripts have different fallback image names.

Alchemy commands are documented in `DEVELOPMENT.md`; inspect the plan before applying a remote deployment:

```bash
npm exec --offline -- alchemy plan
npm exec --offline -- alchemy deploy
```

## Code Conventions & Common Patterns

- Use strict TypeScript with `NodeNext`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, and `verbatimModuleSyntax`. Keep compiler errors resolved rather than weakening `tsconfig.json`.
- Use Effect generator style (`Effect.gen`, `yield*`) for orchestration and wrap fallible effects with `Effect.try`, `Effect.tryPromise`, or equivalent typed Effect constructors.
- Preserve tagged error classes (`ConfigurationError`, `BrowserError`, `MonitorError`, `StateError`, `ShoutrrrError`, `HermesError`) and error causes. Use `Effect.ensuring` for resource cleanup.
- Prefer pure functions for URL construction, filter encoding, payload parsing, robots matching, SHPS classification, and sold-price calculations. Inject browser, state, notification, and subprocess dependencies rather than monkey-patching globals.
- Keep notification and state transitions ordered: a listing is not treated as successfully notified until delivery succeeds; persistent seen-state behavior and first-run seeding must remain explicit.
- Keep all Daft access behind the browser/robots/rate-limit boundary. Do not add ad hoc fetches that bypass robots or pacing.
- Tests use dependency injection, temporary directories/executables, and in-memory payloads. Avoid real network calls or shared persistent state in unit tests.
- ESLint runs with `--max-warnings=0`; do not introduce warning suppression or broad type escapes.

## Important Files

- `package.json`: scripts, dependencies, Node engine, and git-hook commands.
- `src/main.ts`: process entry point and lifecycle.
- `src/config.ts`: environment parsing, defaults, and validation.
- `src/monitor.ts`: poll orchestration and notification/state ordering.
- `src/browser.ts`: Playwright/CDP retrieval, robots enforcement, and rate limiting.
- `src/daft/parser.ts`, `sections.ts`, `url.ts`, `filters.ts`: listing and search semantics.
- `src/daft/shps.ts`, `src/daft/sold.ts`: scheme classification and sold comparisons.
- `src/state.ts`, `src/hermes.ts`, `src/shoutrrr.ts`: persistence and notification backends.
- `scripts/test.mjs`: esbuild test bundling and Node test-runner invocation.
- `scripts/changed-validation.mjs`: changed-file coverage/mutation selection and thresholds.
- `scripts/e2e.mjs`, `scripts/e2e-live.mjs`: fixture and live production-image acceptance tests.
- `.c8rc.json`, `stryker.config.mjs`: coverage and mutation policy.
- `Dockerfile`, `.dockerignore`: pinned multi-stage production image and cache boundaries.
- `.github/workflows/pull-request.yml`, `push.yml`, `publish.yml`: required quality, E2E, image, provenance, and signing gates.
- `DEVELOPMENT.md`, `.env.example`: local operations, environment variables, E2E, and deployment runbook.

## Runtime/Tooling Preferences

- Use Node.js **24.21.0** (`.node-version`) with npm and the committed `package-lock.json`. `package.json` requires Node `>=24`.
- TypeScript 7 is supplied by `@typescript/native`; the `typescript` dependency is a TypeScript 6 compatibility alias for tooling. Do not casually replace either alias.
- `.npmrc` pins the npm registry, disables funding prompts, audits dependencies, and ignores lifecycle scripts. Use `npm ci --ignore-scripts`; use `npm exec --offline -- ...` instead of `npx`.
- On macOS use Apple’s native `container` CLI. Linux CI and Jarvis use Docker. Override E2E selection with `CONTAINER_CLI` when necessary.
- The production image uses a pinned Node 24 Bookworm Slim digest, verified Shoutrrr binaries, Chromium, a non-root `node` user, `/data` persistence, and a heartbeat healthcheck. Do not remove these hardening/runtime properties.
- Keep secrets in environment files or deployment secret stores. Never commit credentials, webhook secrets, tokens, or generated runtime state.
- GitHub Actions are pinned to immutable commit SHAs. PR validation runs dependency review, Gitleaks, Socket Firewall, npm audits/signature checks, changed-file validation, the full quality gate, and live Daft E2E. Push validation repeats security/changed checks and global coverage; publish runs fixture/live E2E before multi-arch GHCR publication, provenance attestation, and Cosign signing.

## Testing & QA

- `npm test` bundles every `test/*.test.ts` with esbuild into `.cache/test-bundle/` and executes Node’s built-in `node:test` runner with `node:assert/strict`.
- `.c8rc.json` enforces **100% statements** and **100% functions** for included `src/**/*.ts`. It intentionally excludes `browser.ts`, `healthcheck.ts`, `main.ts`, `runtime-metrics.ts`, and `state.ts`; do not describe that as whole-repository coverage.
- `stryker.config.mjs` targets `src/config.ts`, `src/daft/**/*.ts`, `src/monitor.ts`, and `src/shoutrrr.ts` with `high`, `low`, and `break` thresholds of **99%**.
- CI’s `npm run check:changed` computes changed mutable line ranges and runs Stryker only for those ranges; it skips mutation when no mutable lines changed. The full `npm run mutation` command remains available but is not the same as the fast changed-file CI gate.
- Add tests for observable behavior, boundaries, state transitions, parser/filter semantics, notification failure handling, and real error paths. Prefer deterministic fixtures and injected transports over implementation assertions.
- Before handing off a non-trivial change, run the narrow relevant check, then `npm run check` when production code or tests changed. For image/runtime changes, run the appropriate fixture or live E2E; for deployment changes, verify container health and the running image revision.
