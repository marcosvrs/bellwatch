# Daft house search monitor

Headless Effect monitor for Daft.ie new-home listings. It renders the Daft
search page with Playwright, extracts unit-level findings from `__NEXT_DATA__`,
and publishes unseen findings to ntfy. There is no HTTP server, UI, or
Dashboard.

The runtime needs one container. Chromium can run in that container, or the
monitor can connect to an external Playwright/CDP service such as the
`browser-sockpuppet-chrome` service on Jarvis.

## Defaults

The default search preserves the original project’s search:

- Daft **New Homes** for sale;
- Dublin City Centre (`dublin-city-centre-dublin`) within 20 km;
- houses;
- at least 3 beds;
- maximum price €499,999;
- price low to high;
- one result page;
- existing results are seeded silently on the first successful poll.

New-home unit data is used when Daft exposes it. A development card is used as
one fallback finding when its unit data is unavailable. Help to Buy or other
scheme eligibility is not inferred from listing text.

## Configuration

`NTFY_URL` is required. It is the full ntfy topic endpoint, for example
`https://ntfy.example/daft-house-search`.

### Daft web filters

The following variables map directly to the current Daft New Homes search
controls. Comma-separated variables support the web control’s multi-select
values.

| Daft control | Environment variable | Values/default |
| --- | --- | --- |
| Location | `DAFT_LOCATION_PATH` | Daft URL slug; default `dublin-city-centre-dublin` |
| Radius | `DAFT_RADIUS_KM` | `0`, `1`, `3`, `5`, `10`, `20`; default `20` |
| Price min/max | `DAFT_PRICE_MIN_EUR`, `DAFT_PRICE_MAX_EUR` | Non-negative euro amounts; default max `499999` |
| Beds min/max | `DAFT_BEDS_MIN`, `DAFT_BEDS_MAX` | `0`–`15`; default min `3` |
| Type | `DAFT_PROPERTY_TYPES` | `houses`, `detached-houses`, `semi-detached-houses`, `terraced-houses`, `end-of-terrace-houses`, `townhouses`, `apartments`, `studio-apartments`, `duplexes`, `bungalows`; default `houses` |
| Baths min/max | `DAFT_BATHS_MIN`, `DAFT_BATHS_MAX` | `1`–`5` |
| Media Type | `DAFT_MEDIA_TYPES` | `video`, `virtual-tour`; empty or `any` means Any Media |
| Keyword / Address Search | `DAFT_KEYWORD` | Max 50 characters |
| Availability | `DAFT_AVAILABILITY` | `published` or `sale-agreed`; default `published` |
| Added In Last | `DAFT_ADDED_IN_LAST_DAYS` | `0`, `1`, `3`, `7`, `14`, `30`; default `0` (any time) |
| Open Viewings From | `DAFT_OPEN_VIEWINGS_FROM` | `YYYY-MM-DD` |
| Sort | `DAFT_SORT` | `bestMatch`, `publishDateDesc`, `priceAsc`, `priceDesc`; default `priceAsc` |

Additional search variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DAFT_BASE_URL` | `https://www.daft.ie` | Daft origin; useful for controlled tests |
| `DAFT_SECTION_PATH` | `new-homes-for-sale` | Daft search route |
| `DAFT_MAX_PAGES` | `1` | Maximum pages to render per poll, `1`–`20` |

Use `DAFT_PROPERTY_TYPES=any` for Any Property. The URL follows Daft’s
behavior: one type is a path segment, while multiple types become repeated
`propertyType` query parameters.

### Browser modes

| Variable | Default | Purpose |
| --- | --- | --- |
| `BROWSER_MODE` | `auto` | `auto`, `external`, or `local` |
| `PLAYWRIGHT_WS_ENDPOINT` | unset | External CDP WebSocket endpoint |
| `CHROMIUM_EXECUTABLE_PATH` | unset | Optional local Chromium executable; unset uses Playwright’s managed browser |
| `CHROMIUM_HEADLESS` | `true` | Local Chromium headless mode |
| `CHROMIUM_NO_SANDBOX` | `false` | Explicitly disable local Chromium sandbox when required by a host |
| `BROWSER_TIMEOUT_MS` | `60000` | Connect/navigation timeout |
| `BROWSER_USER_AGENT` | unset | Optional browser user agent |

`auto` uses `PLAYWRIGHT_WS_ENDPOINT` when it is set and otherwise launches the
Chromium installed in the monitor image. `external` requires the endpoint.
The endpoint is consumed with Playwright’s CDP connection API, which is the
protocol exposed by `dgtlmoon/sockpuppetbrowser`.

For Jarvis’s existing browser service, use either:

```text
PLAYWRIGHT_WS_ENDPOINT=ws://browser-sockpuppet-chrome:3000/?--window-size=1920,1080
```

when the monitor joins the same Compose network, or the published host address:

```text
PLAYWRIGHT_WS_ENDPOINT=ws://192.168.50.106:3000
```

### State and optional external resources

| Variable | Default | Purpose |
| --- | --- | --- |
| `STATE_FILE` | `/data/state.sqlite` | SQLite state file when Postgres is not configured |
| `DATABASE_URL` | unset | Optional `postgres://` or `postgresql://` state backend |
| `HEARTBEAT_FILE` | `/data/heartbeat` | Container healthcheck heartbeat |
| `HEALTHCHECK_MAX_AGE_SECONDS` | derived | Maximum heartbeat age before the healthcheck fails |
| `REDIS_URL` | unset | Optional Redis coordination lease |
| `REDIS_LOCK_KEY` | `daft-house-search:monitor` | Redis lease key |
| `REDIS_LOCK_TTL_SECONDS` | `300` | Redis lease lifetime |

SQLite is the default inside the single container; no Postgres service is
required. Set `DATABASE_URL` to use an external Postgres database instead.
Redis is also optional: without `REDIS_URL` the monitor runs as one instance
without a distributed lease; with it, overlapping monitor instances are
serialized by Redis. No Redis or Postgres sidecar is created, preserving the
one-container requirement.

### Polling and ntfy

| Variable | Default | Purpose |
| --- | --- | --- |
| `POLL_INTERVAL_SECONDS` | `900` | Delay between completed polls |
| `NOTIFY_EXISTING_ON_FIRST_RUN` | `false` | Notify current results instead of seeding them |
| `NTFY_TOKEN` | unset | Optional `Bearer` token |
| `NTFY_TITLE_PREFIX` | `Daft new home` | ntfy title prefix |
| `NTFY_PRIORITY` | `default` | ntfy priority header |
| `NTFY_TAGS` | `house,new-home` | Comma-separated ntfy tags |
| `NTFY_TIMEOUT_MS` | `15000` | ntfy request timeout |

A finding is marked seen only after its ntfy request succeeds. Failed delivery
therefore retries on the next poll.

## Local development

Node.js 22+ is required.

```bash
npm ci --legacy-peer-deps
npm run check
```
The Alchemy beta release currently publishes overlapping Effect prerelease
peer ranges, so `--legacy-peer-deps` is intentional and is also used by the
Docker build.

Run the monitor directly after exporting `NTFY_URL` and any filters:

```bash
NTFY_URL=https://ntfy.example/daft-house-search npm start
```

Local mode requires a Chromium executable. For a host installation, install the
matching browser with `npx playwright install chromium`, or set
`CHROMIUM_EXECUTABLE_PATH` explicitly. The container uses the pinned
`mcr.microsoft.com/playwright:v1.63.0-noble` image, which supplies Chromium and
its Linux dependencies.

### Hooks and CI

`npm ci` installs the local Git hooks through `simple-git-hooks`:

- `pre-commit` runs `npm run typecheck`, covering strict Effect code, tests,
  and `alchemy.run.ts` without starting external services.
- `pre-push` runs `npm run check`, which adds the production build and the
  100% statement/function coverage gate.

GitHub Actions keeps the same layers without duplicating expensive work:

- Pull requests run `npm run check`.
- Pushes to `master` run `npm run check` once, then the 90% mutation gate.
- Stale pull-request runs are cancelled; protected-branch push runs are not.

Mutation testing is intentionally absent from local hooks and pull-request
validation because it is substantially slower than the compile/build/coverage
gate. Alchemy plan/deploy are also manual: their Docker context and deployment
secrets are environment-specific, while `npm run typecheck` still validates
the Alchemy stack source.

## Container and Alchemy

The repository contains one Alchemy Stack. It builds the image, creates one
persistent state volume, and runs one `daft-house-search` monitor container.
The image and volume are infrastructure resources; no second application
container is declared.

Alchemy’s Docker provider uses the Docker engine selected by its context. On a
Mac, use Apple’s `container` CLI for local image smoke tests. For Jarvis, run
Alchemy with its Docker SSH context so the image and monitor are built and run
on Jarvis’s existing engine:

```bash
export NTFY_URL=https://ntfy.example/daft-house-search
export ALCHEMY_DOCKER_HOST='host=ssh://marcosvr@jarvis'
export MONITOR_DOCKER_NETWORK='<the Compose network containing browser-sockpuppet-chrome>'
export PLAYWRIGHT_WS_ENDPOINT='ws://browser-sockpuppet-chrome:3000/?--window-size=1920,1080'

npx alchemy plan
npx alchemy deploy
```

If the named state volume already exists outside Alchemy, use the explicit
adoption flow (`npx alchemy deploy --adopt`) after checking the plan. Set
`ALCHEMY_DOCKER_CONTEXT_NAME` to change the generated Docker context name, and
`MONITOR_IMAGE_NAME`, `MONITOR_IMAGE_TAG`, `MONITOR_CONTAINER_NAME`, or
`MONITOR_VOLUME_NAME` to change deployment names.

If the monitor uses the browser’s published Jarvis host port instead of the
Compose DNS name, `MONITOR_DOCKER_NETWORK` is not needed. `npx alchemy destroy`
removes the Alchemy-managed monitor, image, and volume; destroy only after
confirming the volume is disposable.

For a local image smoke test with Apple’s container runtime:

```bash
container system start
container build -t daft-house-search:local .
```

The application itself always runs with SQLite and bundled Chromium when no
external Postgres, Redis, or browser endpoint is supplied.

## Verification

```bash
npm run check
```

The tests cover every Daft filter, all property/media values, URL encoding,
invalid filter ranges, Next data parsing, SQLite persistence, ntfy headers and
failures, first-run seeding, retry behavior, and local/external browser mode
selection.

`npm run coverage` runs c8 with `--all` and enforces 100% statements and
functions coverage. Lines and branches are reported but have no threshold.
The deterministic monitor core is covered: configuration, Daft URL/parser
logic, polling, and ntfy formatting. Browser, database, Redis, process-entry,
and healthcheck adapters remain outside this unit threshold because they
require external runtimes; they are exercised by the integration and container
smokes described above.

`npm run mutation` runs Stryker against the same deterministic core and fails
when the mutation score is below 90%.
