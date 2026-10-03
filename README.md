# Bellwatch

Bellwatch is a scheduled Irish property monitor for Daft.ie and MyHome. It reads
Daft listing payloads and MyHome server-rendered HTML, applies supported
filters, stores dated listing changes, and sends alerts through Shoutrrr,
Hermes, or both.

It is a background container, not a website. Bellwatch exposes no application
HTTP port and does not provide a web UI. It needs outbound access to Daft.ie,
the configured notification service, and any optional browser or database
service.

## What it does

- Monitors new homes, direct property sales, or property rentals nationwide or
  within configured Daft search locations.
- Retains only individual houses with at least three bedrooms; apartments,
  duplexes, and development-only parent records are excluded. Individual houses
  within mixed developments remain eligible.
- Uses MyHome when enabled and when every active filter can be applied safely.
  Unsupported source-wide filters skip MyHome; listings missing an active
  filter fact are excluded and counted in a warning.
- Optionally records SearXNG results as unverified discovery candidates; they
  never enter the listing or notification catalog.
- Keeps provider-specific IDs, URLs, current facts, and dated change history in
  SQLite or PostgreSQL, with an optional Baserow dashboard mirror.
- Classifies Help to Buy text as mentioned, not mentioned, or unknown. This is
  evidence only, not an eligibility decision or a search filter.
- Classifies valid coordinates against Tailte Éireann's 2026 County Dublin
  boundary and identifies the county-plus-20-km area without narrowing
  nationwide collection.
- Records manual registration status, consent status, and user-provided
  evidence; it never automates application forms or consent.
- Adds current-calendar-year sold-property comparisons to sale notifications
  when the listing has the required matching fields.
- Suppresses cross-provider duplicate alerts when exact location, property
  type, and bedroom facts match, while retaining both source records.
- Sends each alert to every configured notification backend before recording it
  as seen.
- Writes a heartbeat for container health checks and logs poll/runtime metrics.
- Checks each target origin's `robots.txt`, paces requests, and does not retry
  blocked or rate-limited listing requests.

> **Legal notice**
>
> Bellwatch is an independent, unofficial project. It is not affiliated with,
> endorsed by, sponsored by, or authorized by Daft.ie, MyHome.ie, or their
> operators or affiliates.
>
> Bellwatch is provided “as is”. To the fullest extent permitted by law, the
> owner and contributors accept no responsibility or liability for how it is
> used, for automated access to third-party services, for notification accuracy
> or delivery, or for decisions made from its output. Users are solely
> responsible for lawful use, permissions, third-party terms, credentials, rate
> limits, privacy, and data protection. Review the current terms for Daft.ie
> and MyHome.ie before running the application.

## Deployment choices

| Deployment | Listing state | Browser | Best for |
| --- | --- | --- | --- |
| Standalone container | SQLite in `/data` | Chromium bundled in the image | The smallest setup |
| Docker Compose | SQLite by default; optional PostgreSQL profile | Browserless Chromium | A separate browser service and optional legacy database |
| Alchemy | Managed Docker volume | Bundled or external CDP browser | Local or remote Docker Engine deployment |

## Quick start: standalone container

The standalone image includes Node.js, the verified Shoutrrr executable, and
headless Chromium. The example below uses Docker; use an equivalent
Docker-compatible runtime when appropriate.

### 1. Create a private environment file

At least one notification backend is required. Keep credentials out of shell
history and source control.

```bash
umask 077
mkdir -p "$HOME/.config/bellwatch"
cat > "$HOME/.config/bellwatch/monitor.env" <<'EOF'
# Shoutrrr example. Replace the topic with a private value.
SHOUTRRR_URL=ntfy://ntfy.sh/replace-with-a-random-topic

# Optional search and scheduling overrides:
# DAFT_SECTION_PATH=new-homes-for-sale
# DAFT_LOCATION=galway-city
# DAFT_PRICE_MAX_EUR=450000
# DAFT_REQUEST_DELAY_MS=1000
# TZ=Europe/Dublin
# POLL_CRON=0 */8 * * *
EOF
```

For Hermes, use all three variables together instead of, or in addition to,
`SHOUTRRR_URL`:

```dotenv
HERMES_WEBHOOK_URL=http://hermes:8644/webhooks/ha-notify
HERMES_WEBHOOK_SECRET=replace-with-the-webhook-secret
HERMES_CHAT_ID=replace-with-the-WhatsApp-chat-id
```

### 2. Pull and start the image

```bash
IMAGE=ghcr.io/marcosvrs/bellwatch:latest
docker pull "$IMAGE"
docker volume create bellwatch-data
docker run --detach \
  --name bellwatch \
  --restart unless-stopped \
  --env-file "$HOME/.config/bellwatch/monitor.env" \
  --volume bellwatch-data:/data \
  "$IMAGE"
```

The first poll runs immediately. Existing results are seeded silently on the
first run unless `NOTIFY_EXISTING_ON_FIRST_RUN=true`.

### 3. Check the monitor

```bash
docker ps --filter name=bellwatch
docker logs --tail=100 bellwatch
docker exec bellwatch node dist/healthcheck.js
```

Use `docker logs --follow bellwatch` separately when you want to stream logs.

The image health check reads `/data/heartbeat`. Keep `/data` writable and
persistent in SQLite mode. Pin a verified image digest for production rather
than deploying the mutable `latest` tag; see [Supply-chain verification](#supply-chain-verification).

[`docker-compose.yml`](docker-compose.yml) starts Bellwatch and Browserless.
SQLite in the persistent `bellwatch-data` volume is the default. PostgreSQL is
an opt-in compatibility profile for deployments that still use its existing
state; the `postgres-data` volume is retained.

Create the environment file from [`.env.example`](.env.example), then set the
required values:

```bash
cp .env.example .env
# Set BROWSERLESS_TOKEN and SHOUTRRR_URL and/or all three HERMES_* variables.
docker compose pull
docker compose up --detach
docker compose logs --follow bellwatch
```

To continue using existing PostgreSQL state, set `DATABASE_URL` and
`POSTGRES_PASSWORD` in `.env`, then run `docker compose --profile postgres up
--detach`. PostgreSQL state is not copied automatically into SQLite; retain the
original database volume and explicitly select its URL before starting if that
history is required. Do not use `docker compose down --volumes` unless deleting
state is intentional.

The Browserless debugging port is bound to `127.0.0.1:3000`; the monitor uses
the internal service name and does not need that host port. Compose forwards
search, provider, Baserow, scheduling, browser, and healthcheck overrides from
`.env` to Bellwatch.

## How a poll works

1. Bellwatch validates the environment, opens SQLite (or an explicitly
   configured PostgreSQL database), and starts a poll immediately. Later polls
   follow `POLL_CRON` in `TZ`; the default interval is eight hours.
2. Daft searches all Ireland unless locations are configured. MyHome searches
   nationwide or uses only regional routes evidenced by its server-rendered
   links. An active filter that MyHome cannot apply causes that source to be
   skipped, not broadened.
3. Each source's `robots.txt` is checked. Daft and MyHome listing requests are
   separated by at least `DAFT_REQUEST_DELAY_MS` (default 1,000 ms). Blocked
   and rate-limited requests fail without retries.
4. Daft listing payloads and MyHome SSR HTML are parsed; MyHome details are
   fetched as HTML only. Active filters require verifiable facts. Listings
   missing any fact needed for an active filter are excluded, not assumed to
   match.
5. Only individual houses with at least three bedrooms enter the catalog.
   Apartment, duplex, and parent-only development results are excluded, while
   qualifying houses from mixed developments remain.
6. Every qualifying source record is stored separately with its source ID,
   source URL, current facts, and dated changes. Matching records across
   providers suppress duplicate alerts, not source history.
7. Optional SearXNG searches run only when configured. Their results are stored
   as unverified candidates and are never promoted to listings or alerts.
8. Notifications are sent to every configured backend; a listing is marked
   seen only after delivery succeeds. Optional Baserow synchronization writes
   the current listing/candidate views, and the monitor updates the heartbeat.

A successful search with no results is not an error. Poll, browser, parser,
state, and notification-cycle failures are logged and sent through the
configured notification backends when possible.

## Configuration

Put variables in the environment file passed to the container. Recreate the
container after changing them. Invalid values, incomplete backend credentials,
unsupported profile filters, and reversed min/max ranges stop startup with a
configuration error.

### Notification backends

| Variable | Required when | Description |
| --- | --- | --- |
| `SHOUTRRR_URL` | Shoutrrr is enabled | A complete Shoutrrr service URL, such as ntfy, Discord, Gotify, or Slack. |
| `HERMES_WEBHOOK_URL` | Hermes is enabled | Hermes HTTP(S) webhook endpoint. |
| `HERMES_WEBHOOK_SECRET` | Hermes is enabled | Secret used to sign webhook requests with HMAC-SHA256. |
| `HERMES_CHAT_ID` | Hermes is enabled | WhatsApp chat or group ID sent in the payload. |

Set `SHOUTRRR_URL`, all three `HERMES_*` variables, or both complete
configurations. A partial Hermes configuration is rejected. When both are
configured, every finding and poll-error notification is sent to both.

### Search scope and common filters

| Variable | Default | Accepted values / behavior |
| --- | --- | --- |
| `DAFT_BASE_URL` | `https://www.daft.ie` | HTTP(S) origin without credentials, query, or fragment. Useful for deterministic fixtures. |
| `DAFT_SECTION_PATH` | `new-homes-for-sale` | `new-homes-for-sale`, `property-for-sale`, or `property-for-rent`. |
| `DAFT_LOCATION` | unset | Comma-separated Daft location slugs. Each location is searched separately and results are de-duplicated. Unset searches all Ireland. |
| `DAFT_PRICE_MIN_EUR` | unset | Non-negative euro amount; uses the sale or rental price parameter for the selected profile. |
| `DAFT_PRICE_MAX_EUR` | unset | Non-negative euro amount; applies only when explicitly configured. The €500,000 HTB valuation limit is not a purchase-price search cap. |
| `DAFT_BEDS_MIN`, `DAFT_BEDS_MAX` | unset | Integer from `0` to `15`. |
| `DAFT_BATHS_MIN`, `DAFT_BATHS_MAX` | unset | Integer from `1` to `5`. |
| `DAFT_RADIUS_KM` | unset | `0`, `1`, `3`, `5`, `10`, or `20`; `0` omits the radius constraint. |
| `DAFT_PROPERTY_TYPES` | unset | Comma-separated values: `houses`, `detached-houses`, `semi-detached-houses`, `terraced-houses`, `end-of-terrace-houses`, `townhouses`, `apartments`, `studio-apartments`, `duplexes`, `bungalows`, or `sites`. Use `any` alone for all types. |
| `DAFT_MEDIA_TYPES` | unset | `video`, `virtual-tour`, or `any`. `any` must be used alone. |
| `DAFT_KEYWORD` | unset | Keyword or address, maximum 50 characters. |
| `DAFT_AVAILABILITY` | `published` | `published` or `sale-agreed`. |
| `DAFT_ADDED_IN_LAST_DAYS` | unset | `0`, `1`, `3`, `7`, `14`, or `30`; `0` or unset means any age. |
| `DAFT_SORT` | Daft default | `bestMatch`, `publishDateDesc`, `priceAsc`, or `priceDesc`. |
| `DAFT_MAX_PAGES` | unset | Integer from `1` to `20` per location. Unset reads all result pages. |
| `DAFT_REQUEST_DELAY_MS` | `1000` | Minimum milliseconds between Daft browser navigations and MyHome HTTP requests; accepted range `1000`–`60000`. |

With one configured location, the location is represented in the Daft path;
radius and the other filters are encoded in the query. With multiple locations,
Bellwatch makes one single-location request per value rather than relying on
Daft's multi-location UI behavior. Example:

```dotenv
DAFT_SECTION_PATH=new-homes-for-sale
DAFT_LOCATION=dublin-city,drogheda-and-surrounds-louth
DAFT_PROPERTY_TYPES=houses
```

This results in separate searches for `dublin-city` and
`drogheda-and-surrounds-louth`, followed by merge and de-duplication.

### Section-specific filters

| Section | Additional filters | Other behavior |
| --- | --- | --- |
| `new-homes-for-sale` | `DAFT_OPEN_VIEWINGS_FROM` (`YYYY-MM-DD`) | Supports SHPS filtering. |
| `property-for-sale` | `DAFT_FLOOR_SIZE_MIN_SQM`, `DAFT_FLOOR_SIZE_MAX_SQM`, `DAFT_BER_MIN`, `DAFT_BER_MAX`, `DAFT_SALE_TYPE`=`auction`, `DAFT_ONLINE_OFFERS` | Supports sale facilities and sold comparisons. |
| `property-for-rent` | `DAFT_LEASE_LENGTH_MIN_MONTHS`, `DAFT_LEASE_LENGTH_MAX_MONTHS`, `DAFT_FURNISHING` | Supports rental facilities; no sold comparisons. |

Sale BER values are `exempt`, `G`, `F`, `E`, `D`, `C`, `B`, `A`, and `A0`.
Lease lengths are `3`, `6`, `9`, `12`, `24`, or `36` months. Furnishing is
`furnished` or `unfurnished`. `DAFT_ONLINE_OFFERS` accepts a boolean.

`DAFT_FACILITIES` is profile-specific:

- Sale: `alarm`, `gas-fired-central-heating`,
  `oil-fired-central-heating`, `parking`, `wheelchair-access`, or
  `wired-for-cable-television`.
- Rental: `alarm`, `cable-television`, `central-heating`, `dishwasher`, `dryer`,
  `garden-patio-balcony`, `internet`, `microwave`, `parking`, `pets-allowed`,
  `serviced-property`, `smoking`, `washing-machine`, or `wheelchair-access`.

Use `DAFT_FACILITIES=any` alone to remove facility constraints for sale or
rental searches. Facilities are not supported for new-home searches.

### SHPS filtering

`SHPS_FILTER` defaults to `off` and is valid only with
`new-homes-for-sale`:

| Value | Result |
| --- | --- |
| `off` | Keep all matching listings. |
| `only` | Keep listings with proven SHPS-only evidence; uncertain listings are removed. |
| `exclude` | Remove only listings proven to be SHPS-only; uncertain listings remain. |

`only` and `exclude` inspect listing detail text. This is a text classification
filter, not a legal eligibility determination; verify eligibility with the
relevant scheme and local authority.

### Polling

| Variable | Default | Description |
| --- | --- | --- |
| `POLL_CRON` | `0 */8 * * *` | Five- or six-field crontab expression; the default runs at 00:00, 08:00, and 16:00. |
| `TZ` | Runtime-detected timezone | IANA timezone used to interpret `POLL_CRON`. |
| `NOTIFY_EXISTING_ON_FIRST_RUN` | `false` | Notify current results on the first poll instead of silently seeding them. |

### Browser

| Variable | Default | Description |
| --- | --- | --- |
| `PLAYWRIGHT_WS_ENDPOINT` | unset | `ws://` or `wss://` Playwright/CDP endpoint. When unset, the image launches bundled headless Chromium. |
| `BROWSER_USER_AGENT` | Built-in Chrome user agent | Optional browser user-agent override. |


### MyHome, SearXNG, and Baserow

| Variable | Default | Description |
| --- | --- | --- |
| `MYHOME_ENABLED` | `true` | Set `false` to disable MyHome. |
| `MYHOME_BASE_URL` | `https://www.myhome.ie` | MyHome origin; public server-rendered HTML only. No private or undocumented API is used. |
| `SEARXNG_BASE_URL` | unset | Optional HTTP(S) SearXNG base URL. When set, search results are saved only as unverified candidates. |
| `BASEROW_BASE_URL` | unset | HTTP(S) URL of a Baserow instance. |
| `BASEROW_TOKEN` | unset | Baserow database token. |
| `BASEROW_TABLE_ID` | unset | Listing table ID; required with the other Baserow values. |
| `BASEROW_CANDIDATE_TABLE_ID` | unset | Separate candidate table ID; required when both Baserow and SearXNG are enabled. |

MyHome is fail-closed: an active filter the source cannot safely apply skips
MyHome for that poll. If an individual record lacks a fact required by an
active filter, it is excluded and the warning reports the number of affected
records; other verifiable records remain eligible. Regional MyHome paths are
used only when their route is evidenced by the nationwide page's rendered links.
When `DAFT_MAX_PAGES` and `DAFT_SORT` are both set, MyHome is skipped for
that poll because sorting a page-limited subset cannot guarantee the requested
order.

SearXNG is never queried unless `SEARXNG_BASE_URL` is set. Search results do not
become listings, do not generate listing alerts, and are kept in a separate
candidate table when Baserow mirroring is enabled.

Repeated SearXNG sightings retain their initial discovery timestamp; only
changes to the candidate details create a new candidate observation.

### Help to Buy evidence

Help to Buy evidence is recorded as `mentioned`, `not-mentioned`, or `unknown`
from listing text. Use this field to prioritize manual review; it does not
filter listings, rank notifications, or decide eligibility. The €500,000
scheme valuation ceiling is not a purchase-price cap and is never applied as a
default search filter. `SHPS_FILTER` is a separate scheme-specific option.

### County Dublin geography

Every listing with valid coordinates is classified against Tailte Éireann's
2026 County Dublin statutory boundary. The source returns multiple Dublin
polygon features; Bellwatch validates and combines the complete FeatureCollection.
`withinDublin20Km` includes County Dublin and points up to 20 km from its boundary
by straight-line WGS84 distance. This is a dashboard view, not a collection
filter; nationwide records remain stored. Missing/invalid coordinates and
boundary-fetch failures are retained as `unclassified` with a reason.
Boundary attribution:
County boundary data © Tailte Éireann, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

### Manual registration history

Record a manual outcome for an existing source listing after the user has
personally reviewed the relevant process:

```bash
npm run registration -- \
  --listing=daft:12345 \
  --status=confirmed \
  --consent=consented \
  --evidence="User confirmed the registration outcome."
```

`--listing` must use a stored `daft:<id>` or `myhome:<id>` key.
`--status` accepts `confirmed`, `unconfirmed`, `failed`, or `skipped`.
`--consent` accepts `unknown`, `consented`, `declined`, or `not-applicable`.
Evidence is a required user-entered note. Each command appends a dated event
to local state; the latest status and complete history are mirrored to Baserow
on the next monitor sync. Bellwatch never submits forms, clicks consent,
handles CAPTCHA, or infers consent.

### Baserow table fields

Create the listing table with these field names (use text/long-text, number,
boolean, date-time, and URL fields as indicated by the data):

`bellwatch_key`, `source`, `source_id`, `title`, `development_title`,
`price_text`, `bedrooms`, `bathrooms`, `property_type`, `floor_size_sqm`,
`ber_rating`, `help_to_buy_evidence_status`, `registration_status`,
`registration_consent_status`, `registration_evidence`,
`registration_updated_at`, `registration_history_json`, `address`, `eircode`,
`latitude`, `longitude`, `dublin_status`, `dublin_in_county`,
`dublin_boundary_distance_km`, `dublin_within_20km`,
`dublin_unclassified_reason`, `source_url`, `first_seen_at`, and
`last_seen_at`.

Create a separate candidate table when configured with SearXNG:
`candidate_key`, `source`, `verified`, `title`, `url`, `snippet`, `engine`,
`discovered_at`, `first_seen_at`, and `last_seen_at`. `price_text` preserves
values such as `POA`; unavailable numeric facts remain empty. Baserow sync
upserts current rows from a persistent local outbox. Failed sync entries remain
pending for a later monitor cycle without losing local listing history.

### State and health

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | unset | `postgres://` or `postgresql://` URL. When set, state uses PostgreSQL; otherwise it uses SQLite. Compose defaults to SQLite. |
| `HEALTHCHECK_MAX_AGE_SECONDS` | `86400` | Maximum allowed heartbeat age. Increase it for schedules longer than one day. |

Without `DATABASE_URL`, listing state is stored at `/data/state.sqlite`; persist
`/data` across restarts. PostgreSQL mode still needs `/data` writable for
`/data/heartbeat`. The catalog stores the current structured facts per
provider-specific listing key and dated observations when facts change,
including source IDs, source URLs, floor area, and POA text. It also stores
unverified candidates and manual registration history. It does not store
listing images or advertiser account details.

On an existing state database, startup keeps legacy seen rows and adds
namespaced `daft:` copies so those listings are not treated as new after
upgrade. PostgreSQL data is never copied into SQLite automatically.

## Sold-property comparisons

For `new-homes-for-sale` and `property-for-sale`, Bellwatch queries Daft sold
properties from the current calendar year when a finding has matching
bedrooms, bathrooms, property type, BER, and floor-size data.

- Configured locations scope sold searches one location at a time.
- Without a configured location, Bellwatch uses the finding's Eircode or
  address when detail-page data provides one.
- Matching sold listings are de-duplicated before calculating the price range.
- Notifications include the sold price range, comparable count, and a verdict:
  potentially above, within, below, or unavailable.
- Sold lookup failures are best-effort: Bellwatch logs a warning and can still
  deliver the original finding.

Rental notifications do not perform sold-property lookups.

## Operate and update

Stop and start without losing state:

```bash
docker stop bellwatch
docker start bellwatch
```

To replace the container while retaining its volume, prefer a verified digest:

```bash
IMAGE=ghcr.io/marcosvrs/bellwatch@sha256:replace-with-published-digest
docker pull "$IMAGE"
docker stop bellwatch
docker rm bellwatch
docker run --detach \
  --name bellwatch \
  --restart unless-stopped \
  --env-file "$HOME/.config/bellwatch/monitor.env" \
  --volume bellwatch-data:/data \
  "$IMAGE"
```

In SQLite mode, deleting `bellwatch-data` resets listing history and causes
current results to be treated as new. In PostgreSQL mode, that volume contains
only heartbeat data; reset the PostgreSQL data volume separately if a history
reset is intended.

## Supply-chain verification

Published images are built only after fixture and live production-image E2E
gates. The publish workflow produces multi-architecture images, SBOM and
provenance attestations, and a keyless Cosign signature. Resolve a release tag
to its immutable digest before deployment:

```bash
docker buildx imagetools inspect ghcr.io/marcosvrs/bellwatch:latest
```

Verify the selected digest with Cosign:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/marcosvrs/bellwatch/.github/workflows/publish.yml@refs/heads/master' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/marcosvrs/bellwatch@sha256:replace-with-published-digest
```

Deploy the verified digest, not the mutable `latest` tag.

## Alchemy deployment

[`alchemy.run.ts`](alchemy.run.ts) builds the production image, creates the
persistent state volume, starts a healthchecked monitor container, and can
target a remote Docker Engine over SSH.

For a local target:

```bash
npm ci --legacy-peer-deps --ignore-scripts
npm run prepare
export SHOUTRRR_URL=ntfy://ntfy.sh/replace-with-a-private-topic
npm exec --offline -- alchemy plan
npm exec --offline -- alchemy deploy
```

Supply `MYHOME_ENABLED`, `MYHOME_BASE_URL`, `SEARXNG_BASE_URL`, and the
Baserow base/table settings as environment variables when needed. Alchemy
forwards `BASEROW_TOKEN` as a redacted secret; `DATABASE_URL` explicitly keeps
PostgreSQL state instead of the default SQLite volume.

Set `ALCHEMY_DOCKER_HOST=host=ssh://user@remote-host` for a remote target. Use
`MONITOR_DOCKER_NETWORK` when the monitor must join an existing browser
network, and pass `PLAYWRIGHT_WS_ENDPOINT` when using an external browser.
Inspect the plan before applying it. `npm exec --offline -- alchemy destroy`
is destructive: it removes the managed container, image, and state volume.
See [`DEVELOPMENT.md`](DEVELOPMENT.md) for the complete deployment runbook and
resource-name overrides.

## Development and validation

Maintainers should use Node.js **24.21.0** from [`.node-version`](.node-version).
The repository uses npm, strict TypeScript, Effect, and Node's built-in test
runner; tests are bundled with esbuild, so no TypeScript runtime loader is
needed.

```bash
npm cache verify
npm ci --ignore-scripts
npm run prepare
npm run security:local
npm run check
```

Focused commands:

```bash
npm run lint
npm run typecheck
npm run build
npm test
npm run coverage
npm run mutation
npm run check:changed -- origin/master HEAD
```

The full quality check enforces 100% statements and functions for its included
source set. Mutation testing uses Stryker; changed-file validation limits
mutation to changed mutable line ranges. Use `npm exec --offline -- ...` rather
than `npx` for local executables.

### Production-image E2E

The fixture E2E builds and runs the production image against a local Daft-like
fixture and local notification sink. It does not contact Daft or external
notifications:

```bash
container system start
container build -t bellwatch:e2e .
CONTAINER_CLI=container E2E_IMAGE=bellwatch:e2e npm run e2e
```

The live E2E uses the same image against `https://www.daft.ie`, validates the
real listing payload shape, verifies a signed Hermes payload, and runs the
production healthcheck:

```bash
CONTAINER_CLI=container E2E_IMAGE=bellwatch:e2e npm run e2e:live
```

On Linux, set `CONTAINER_CLI=docker`. The fixture and live scripts have
different default image names, so set `E2E_IMAGE` explicitly when running both.
The full maintainer workflow is in [`DEVELOPMENT.md`](DEVELOPMENT.md).

Pull requests run security checks, changed-file mutation validation, the full
quality gate, and live Daft E2E. Master pushes run security, changed-file
validation, and coverage. Successful publication runs fixture and live E2E
before publishing `latest` and a commit-specific SHA tag.

## Responsible use and privacy

Bellwatch reads public Daft.ie and MyHome.ie listing pages and sends listing
details and URLs to your selected notification backend. Optional SearXNG
results remain unverified candidates. Treat credentials, webhook secrets,
service URLs, notification content, and listing history as private.

Bellwatch does not log in to listing sites, use private or undocumented APIs,
bypass access controls, solve CAPTCHAs, submit application forms, or automate
consent. It checks and obeys each target origin's `robots.txt`; a disallowed URL
fails, retrieval errors fail closed, and a missing `robots.txt` returns no
rules. Daft and MyHome listing requests are paced by at least one second by
default. Blocked and rate-limited source requests are not retried. Compliance
with robots rules and request pacing does not itself grant permission to
automate access; review current third-party terms before running the service.

## Troubleshooting

- **No listing notification:** the first poll is silent by default. Check
  `NOTIFY_EXISTING_ON_FIRST_RUN`, the selected section and filters, backend
  variables, and `docker logs bellwatch`.
- **Duplicate notifications after restart:** restore the original `/data`
  volume in SQLite mode or the PostgreSQL database in external-state mode.
- **Unhealthy container:** confirm `/data` is writable and the schedule is not
  longer than `HEALTHCHECK_MAX_AGE_SECONDS`.
- **Browser connection error:** remove `PLAYWRIGHT_WS_ENDPOINT` to use bundled
  Chromium, or make the external `ws://`/`wss://` endpoint reachable from the
  monitor container.
- **Startup configuration error:** check accepted values, profile-specific
  filters, min/max ordering, and complete notification backend credentials.
- **Robots or rate-limit failure:** do not bypass the policy. Inspect logs and
  keep the configured delay at or above the enforced minimum; wait for the next
  scheduled poll rather than retrying the request.
- **No sold comparison:** the finding may lack one of the required matching
  fields, have no spatial scope, be a rental, or have no comparable sales.

## Contact

For non-sensitive bugs, compliance questions, or removal requests, use the
[repository issue tracker](https://github.com/marcosvrs/bellwatch/issues). Do
not include credentials, personal data, or private listing information in a
public issue. For sensitive requests, contact the repository owner through
their [GitHub profile](https://github.com/marcosvrs) instead.

## License

Bellwatch is released under [MIT-0](LICENSE). This license applies only to
Bellwatch; it does not grant rights to Daft.ie, its content, or any other
third-party service. Direct runtime dependency notices are in
[`THIRD_PARTY_NOTICES`](THIRD_PARTY_NOTICES); their licenses remain separate.
