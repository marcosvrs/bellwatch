# Bellwatch

Get a notification through Shoutrrr or Hermes when a new home matching your
Daft.ie search appears.
The monitor runs continuously in one container, remembers listings it has
already reported, and sends only unseen findings.

It is a background service, not a website: there is no HTTP server, web UI, or
dashboard. The container has no inbound port. It only needs outbound access to
Daft.ie, your configured notification backend, and any optional external services
you configure.

## Contents

- [What it does](#what-it-does)
- [Useful ways to run it](#useful-ways-to-run-it)
- [Requirements](#requirements)
- [Quick start with Docker](#quick-start-with-docker)
- [Docker Compose stack](#docker-compose-stack)
- [Configure the search](#configure-the-search)
- [Configure notifications and polling](#configure-notifications-and-polling)
- [Use a different browser](#use-a-different-browser)
- [Choose where state is stored](#choose-where-state-is-stored)
- [Operate the container](#operate-the-container)
- [Troubleshooting](#troubleshooting)
- [Privacy and security](#privacy-and-security)

## What it does

Each polling cycle the monitor:

1. Builds the Daft New Homes search URL from your filters.
2. Uses Playwright and Chromium to render one or more result pages.
3. Extracts individual units when Daft provides unit data. If a development has
   no unit data, it becomes one fallback finding.
4. Removes duplicate findings across pages.
5. Compares findings with persistent state.
6. Publishes unseen findings through the configured notification backend and
   marks them seen only after the notification service accepts the notification.
7. Writes a heartbeat for the container healthcheck.

A notification includes the listing title, price, bedrooms, bathrooms, property
type, development, and a clickable Daft URL. Help to Buy or other scheme
eligibility is not inferred from listing text.

On the first successful poll, existing results are seeded silently by default.
Set `NOTIFY_EXISTING_ON_FIRST_RUN=true` when the current results should be sent
immediately instead.

## Useful ways to run it

- **Personal home alerts:** monitor one search on a home server or Mac and
  receive new-listing notifications through your configured service.
- **Different searches:** run separate containers, each with its own env file,
  state volume, and notification backend configuration. This keeps searches and
  notification independent.
- **Existing browser infrastructure:** connect to a Playwright/CDP browser
  service instead of launching Chromium in this container.
- **Shared or redundant deployment:** use Postgres for shared seen-listing state
  and Redis for a distributed lease when more than one monitor instance runs.
- **Remote Docker host:** run the same published image on a home server, VPS,
  or managed Docker host with its own persistent `/data` volume.

## Requirements

- A notification backend: either a Shoutrrr service URL, such as ntfy, Discord,
  Gotify, or Slack, or a Hermes webhook URL, secret, and WhatsApp chat ID.
- A Docker Engine or compatible OCI runtime. The production examples below use
  Docker.
- Outbound HTTPS access to Daft.ie and network access to the configured
  notification backend.
- A persistent container volume mounted at `/data`.
- Optional: a Postgres database, Redis server, or external Playwright/CDP
  endpoint when you need them.

## Quick start with Docker

This is the normal production setup. The maintained image is published to
GitHub Container Registry, so users pull it instead of building the repository.
The image includes Chromium and declares `/data` as its persistent volume.

The first pull needs access to `ghcr.io`. Runtime access to Daft and the
configured notification service is also required. If the package is private,
authenticate Docker to GitHub Container Registry before pulling it.

### 1. Create the notification configuration

Create an env file outside the repository. Keep it private because it may
contain notification credentials, a Shoutrrr service URL, or database credentials.

```bash
umask 077
mkdir -p "$HOME/.config/bellwatch"
cat > "$HOME/.config/bellwatch/monitor.env" <<'EOF'
# Default backend: Shoutrrr with the public ntfy service.
NOTIFICATION_BACKEND=shoutrrr
SHOUTRRR_URL=ntfy://ntfy.sh/replace-with-a-long-random-topic

# Hermes alternative:
# NOTIFICATION_BACKEND=hermes
# HERMES_WEBHOOK_URL=http://hermes:8644/webhooks/ha-notify
# HERMES_WEBHOOK_SECRET=replace-with-the-Hermes-webhook-secret
# HERMES_CHAT_ID=replace-with-the-WhatsApp-chat-id

# Optional: put service credentials in the Shoutrrr URL when required.
# SHOUTRRR_TITLE_PREFIX=Bellwatch new home

# Optional overrides. Omit these to use the parser defaults.
# DAFT_LOCATION_PATH=galway-city
# DAFT_PRICE_MAX_EUR=450000
# DAFT_BEDS_MIN=2
# POLL_INTERVAL_SECONDS=1800
EOF
```

`NOTIFICATION_BACKEND=shoutrrr` uses the configured Shoutrrr service URL. For
direct Hermes WhatsApp delivery, set `NOTIFICATION_BACKEND=hermes` and provide
the `HERMES_*` variables documented below.

### 2. Pull the published image

```bash
IMAGE=ghcr.io/marcosvrs/bellwatch:latest
docker pull "$IMAGE"
```

The image runs as the non-root `pwuser`, exposes no application port, and
contains the precompiled native Node.js application, pinned Playwright/Chromium
runtime, and Shoutrrr CLI. TypeScript and `tsx` are build/test-only and are not
included in the production image.

### 3. Create storage and start the monitor

Create the named volume once:

```bash
docker volume create bellwatch-data
```

Start the monitor:

```bash
docker run --detach \
  --name bellwatch \
  --restart unless-stopped \
  --env-file "$HOME/.config/bellwatch/monitor.env" \
  --volume bellwatch-data:/data \
  "$IMAGE"
```

The monitor starts polling with the default search immediately. The first poll
can take up to the browser timeout plus the Daft response time.

### 4. Confirm that it is running

```bash
docker ps --filter name=bellwatch
docker logs --follow bellwatch
```

A successful cycle logs the number of pages, findings, notifications, and
first-run seedings, plus low-overhead Node.js runtime metrics: RSS and heap
memory, CPU time, event-loop utilization, and garbage-collection counts and
duration. These metrics cover the Bellwatch Node.js process; local Chromium
and external Browserless resources must be measured at the container/service
level. The image healthcheck runs automatically against the heartbeat file:

```bash
docker exec bellwatch node dist/healthcheck.js
```

### Updating the image

The `/data` volume contains the seen-listing state. Keep it when updating the
image:

```bash
IMAGE=ghcr.io/marcosvrs/bellwatch:latest
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

Do not delete `bellwatch-data` unless you intentionally want the next
run to treat every current listing as unseen. Docker will restart the container
after a Docker Engine or host restart because of `--restart unless-stopped`.

## Docker Compose stack

Use the included [`docker-compose.yml`](docker-compose.yml) when you want the
monitor and its optional external services in one Docker network. It starts:

- the published `bellwatch` image;
- Postgres for shared listing state;
- Redis for the distributed polling lease; and
- Browserless Chromium for external Playwright/CDP connections.

The monitor container is configured automatically with:

```text
SHOUTRRR_URL=ntfy://ntfy.sh/bellwatch
DATABASE_URL=postgresql://...@postgres:5432/daft
REDIS_URL=redis://redis:6379/0
PLAYWRIGHT_WS_ENDPOINT=ws://browserless:3000?token=...
BROWSER_TIMEOUT_MS=120000
DAFT_ADDED_IN_LAST_DAYS=1
DAFT_SORT=publishDateDesc
```

`BROWSER_MODE` is intentionally omitted here. Its default is `auto`, which
selects the external Browserless endpoint when `PLAYWRIGHT_WS_ENDPOINT` is set.

Copy the environment template, replace both placeholder secrets, and start the
stack:

```bash
cp .env.example .env
chmod 600 .env
# Edit .env and replace POSTGRES_PASSWORD and BROWSERLESS_TOKEN.

docker compose pull
docker compose up --detach
docker compose ps
docker compose logs --follow bellwatch
```

The GHCR package must be public for unauthenticated pulls. If it is private,
authenticate first:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io --username YOUR_GITHUB_USER --password-stdin
```

The host exposes the Browserless debugger at `http://127.0.0.1:3000` by default.
Postgres and Redis are reachable only inside the Compose network.

`docker compose down` stops the services but keeps named volumes. Do not use
`docker compose down --volumes` unless you intentionally want to delete the
Postgres, Redis, and listing-history data.

To change a non-secret stack default, edit and uncomment the corresponding
entry in `docker-compose.yml`. Edit `.env` for the required secrets, then
recreate the monitor:

```bash
docker compose up --detach --force-recreate bellwatch
```

The Compose stack intentionally runs Browserless as a separate external
browser. Use the standalone `docker run` setup above when you want the image's
bundled Chromium instead.

## Configure the search

The default search is:

- Daft **New Homes for sale**;
- one or more Daft location paths, defaulting to Dublin City Centre (`dublin-city-centre-dublin`) within 20 km;
- houses with at least 3 bedrooms;
- maximum price €499,999;
- price ascending;
- one result page per location;
- silent seeding of existing results on the first successful poll.

Set variables in the env file and recreate the container after changing them.
Comma-separated values are trimmed and de-duplicated.

### Search filters

| Purpose | Variable | Accepted values | Default |
| --- | --- | --- | --- |
| Daft locations | `DAFT_LOCATION_PATH` | Comma-separated Daft URL paths/slugs, each without a leading slash, query, fragment, or spaces | `dublin-city-centre-dublin` |
| Search section | `DAFT_SECTION_PATH` | Daft URL path | `new-homes-for-sale` |
| Radius | `DAFT_RADIUS_KM` | `0`, `1`, `3`, `5`, `10`, `20` | `20` |
| Minimum price | `DAFT_PRICE_MIN_EUR` | Non-negative euro amount | unset |
| Maximum price | `DAFT_PRICE_MAX_EUR` | Non-negative euro amount | `499999` |
| Minimum bedrooms | `DAFT_BEDS_MIN` | Integer `0`–`15` | `3` |
| Maximum bedrooms | `DAFT_BEDS_MAX` | Integer `0`–`15` | unset |
| Property types | `DAFT_PROPERTY_TYPES` | `houses`, `detached-houses`, `semi-detached-houses`, `terraced-houses`, `end-of-terrace-houses`, `townhouses`, `apartments`, `studio-apartments`, `duplexes`, `bungalows`, or `any` | `houses` |
| Minimum bathrooms | `DAFT_BATHS_MIN` | Integer `1`–`5` | unset |
| Maximum bathrooms | `DAFT_BATHS_MAX` | Integer `1`–`5` | unset |
| Media | `DAFT_MEDIA_TYPES` | `video`, `virtual-tour`, or `any` | `any` |
| Keyword/address | `DAFT_KEYWORD` | Up to 50 characters | unset |
| Availability | `DAFT_AVAILABILITY` | `published` or `sale-agreed` | `published` |
| Added recently | `DAFT_ADDED_IN_LAST_DAYS` | `0`, `1`, `3`, `7`, `14`, or `30` | `0` (any time) |
| Open viewings from | `DAFT_OPEN_VIEWINGS_FROM` | Real date in `YYYY-MM-DD` format | unset |
| Sort order | `DAFT_SORT` | `bestMatch`, `publishDateDesc`, `priceAsc`, `priceDesc` | `priceAsc` |
| Pages per poll | `DAFT_MAX_PAGES` | Integer `1`–`20` | `1` |

Use `any` by itself for `DAFT_PROPERTY_TYPES` or `DAFT_MEDIA_TYPES`; do not
combine it with specific values. For property types, one specific value is
encoded in the Daft path and multiple values are sent as repeated query
parameters.

`DAFT_LOCATION_PATH` can contain multiple locations. Bellwatch applies the
same filters to each location, combines the results, and de-duplicates
listings by Daft listing ID. `DAFT_MAX_PAGES` is the maximum number of pages
fetched for each location.

Examples:

```dotenv
DAFT_LOCATION_PATH=drogheda-louth,navan-meath,dublin-city-centre-dublin
DAFT_RADIUS_KM=10
DAFT_PRICE_MIN_EUR=250000
DAFT_PRICE_MAX_EUR=450000
DAFT_BEDS_MIN=2
DAFT_PROPERTY_TYPES=houses,apartments
DAFT_KEYWORD=near university
DAFT_ADDED_IN_LAST_DAYS=7
DAFT_SORT=publishDateDesc
DAFT_MAX_PAGES=3
```

The monitor rejects invalid values at startup, including reversed min/max
ranges, invalid dates, unsupported filter choices, and malformed URLs.

### Advanced Daft URL settings

| Variable | Purpose |
| --- | --- |
| `DAFT_BASE_URL` | Daft origin. Defaults to `https://www.daft.ie`; useful for controlled tests or a compatible origin. |
| `DAFT_SECTION_PATH` | Search route. Defaults to `new-homes-for-sale`. |
| `DAFT_MAX_PAGES` | Maximum pages fetched per poll. The monitor stops earlier when Daft reports that there are no more pages. |

## Configure notifications and polling

| Variable | Purpose | Default |
| --- | --- | --- |
| `NOTIFICATION_BACKEND` | `shoutrrr` or `hermes` | `shoutrrr` |
| `SHOUTRRR_URL` | Complete Shoutrrr service URL when using `shoutrrr` | Required for `shoutrrr` |
| `SHOUTRRR_BINARY` | Shoutrrr executable path or command | `shoutrrr` |
| `SHOUTRRR_TITLE_PREFIX` | Notification title prefix for services that support titles | `Bellwatch new home` |
| `SHOUTRRR_TIMEOUT_MS` | Shoutrrr notification timeout, from 1,000 to 120,000 ms | `15000` |
| `HERMES_WEBHOOK_URL` | Hermes webhook endpoint, normally `/webhooks/ha-notify` | Required for `hermes` |
| `HERMES_WEBHOOK_SECRET` | Secret used to sign Hermes webhook requests | Required for `hermes` |
| `HERMES_CHAT_ID` | Raw WhatsApp chat or group ID; do not base64-encode it | Required for `hermes` |
| `HERMES_TIMEOUT_MS` | Hermes request timeout per attempt, from 1,000 to 120,000 ms | `20000` |
| `POLL_INTERVAL_SECONDS` | Delay between completed polls, from 1 to 86,400 seconds | `900` |
| `NOTIFY_EXISTING_ON_FIRST_RUN` | Send the current results on first run instead of silently seeding them | `false` |

Hermes requests use the `X-Webhook-Timestamp` and
`X-Webhook-Signature-V2` headers required by the Hermes webhook. HTTP 5xx and
network failures are retried twice; client errors are not retried.

A failed notification does not mark a finding as seen. It is retried on a
later poll. Multiple new findings can be sent during the same poll.

## Use a different browser

The normal container uses the bundled headless Chromium. Set `BROWSER_MODE`
and related variables only when you need a different browser arrangement.

| Variable | Purpose | Default |
| --- | --- | --- |
| `BROWSER_MODE` | `auto`, `local`, or `external` | `auto` |
| `PLAYWRIGHT_WS_ENDPOINT` | Playwright/CDP WebSocket endpoint using `ws://` or `wss://` | unset |
| `CHROMIUM_EXECUTABLE_PATH` | Local Chromium executable path | unset; uses the bundled browser |
| `CHROMIUM_HEADLESS` | Run local Chromium headless | `true` |
| `CHROMIUM_NO_SANDBOX` | Disable the Chromium sandbox when the host requires it | `false` |
| `BROWSER_TIMEOUT_MS` | Browser connection and navigation timeout, from 1,000 to 300,000 ms | `60000` |
| `BROWSER_USER_AGENT` | Optional browser user-agent string | unset |

Mode behavior:

- `auto` connects to `PLAYWRIGHT_WS_ENDPOINT` when it is set; otherwise it
  launches local Chromium.
- `local` always launches Chromium in the monitor container. Use
  `CHROMIUM_EXECUTABLE_PATH` only when the bundled executable is not suitable.
- `external` requires `PLAYWRIGHT_WS_ENDPOINT` and connects using Playwright's
  CDP API.

When `BROWSER_MODE=auto` (the default), setting
`PLAYWRIGHT_WS_ENDPOINT` is enough to select the external browser. Set
`BROWSER_MODE=external` only when you want startup to fail if the endpoint is
missing.

Example for a browser service on the same container network:

```dotenv
PLAYWRIGHT_WS_ENDPOINT=ws://browser-sockpuppet-chrome:3000/?--window-size=1920,1080
```

Example for a browser service published on a reachable host:

```dotenv
PLAYWRIGHT_WS_ENDPOINT=ws://192.168.50.106:3000
```

When both services run as Docker containers, attach the monitor to the browser
service's network by adding `--network <network-name>` to the `docker run`
command. Use `docker network ls` to find the network.

The monitor must be able to resolve and reach the endpoint from inside its
container. `CHROMIUM_NO_SANDBOX=true` reduces browser isolation and should only
be used when the runtime cannot launch Chromium with its sandbox.

## Choose where state is stored

The monitor stores two kinds of state: whether it has initialized, and which
listing IDs it has already reported.

| Variable | Purpose | Default |
| --- | --- | --- |
| `STATE_FILE` | SQLite state file when Postgres is not configured | `/data/state.sqlite` |
| `DATABASE_URL` | Optional `postgres://` or `postgresql://` state backend | unset |
| `HEARTBEAT_FILE` | File updated after a successful poll | `/data/heartbeat` |
| `HEALTHCHECK_MAX_AGE_SECONDS` | Maximum heartbeat age before healthcheck failure | derived from polling interval, minimum 300 seconds |
| `REDIS_URL` | Optional `redis://` or `rediss://` coordination lease | unset |
| `REDIS_LOCK_KEY` | Redis key used by the lease | `bellwatch:monitor` |
| `REDIS_LOCK_TTL_SECONDS` | Lease lifetime, from 10 to 86,400 seconds | `300` |

### SQLite (recommended for one container)

SQLite is the default and requires no extra service. Mount `/data` to a named
volume, as shown in the quick start. Losing that volume resets the seen-listing
history.

### Postgres (shared state)

Set `DATABASE_URL` when state must be shared across deployments or stored
outside the container. The monitor creates its required tables automatically.
The database must be reachable from the monitor container.

### Redis (multiple instances)

Set `REDIS_URL` to serialize polling between instances. For reliable multiple
instances, use Redis together with one shared Postgres database; Redis alone
prevents overlapping polls but does not share each instance's SQLite history.
Use the same `REDIS_LOCK_KEY` for instances that should coordinate.

Compose leaves `REDIS_LOCK_KEY` and `REDIS_LOCK_TTL_SECONDS` unset because the
parser defaults (`bellwatch:monitor` and `300` seconds) are sufficient. Set a
different lock key only when separate monitor groups share Redis but should not
coordinate with one another.

## Operate the container

### View status and logs

```bash
docker ps --filter name=bellwatch
docker inspect bellwatch
docker logs --follow bellwatch
```

The monitor logs configuration failures at startup and a summary after each
completed poll. It does not expose a metrics or admin endpoint.

### Run the healthcheck manually

```bash
docker exec bellwatch node dist/healthcheck.js
```

The image healthcheck uses the same command every 60 seconds. It allows a
120-second startup period and fails when the heartbeat is older than
`HEALTHCHECK_MAX_AGE_SECONDS`, or its derived value of at least five minutes.

### Stop, start, and remove

```bash
docker stop bellwatch
docker start bellwatch
```

To remove only the container while keeping state:

```bash
docker stop bellwatch
docker rm bellwatch
```

To reset all seen-listing history, delete the named volume only after stopping
the container:

```bash
docker volume rm bellwatch-data
```

The exact delete command is intentionally destructive. Create a new volume
instead when testing a different search without affecting the production
history.

## Troubleshooting

### The container starts but sends no notification

1. Check `docker logs bellwatch` for configuration or browser
   errors.
2. Confirm the selected notification backend is configured correctly. For
   Shoutrrr, validate `SHOUTRRR_URL`; for Hermes, validate
   `HERMES_WEBHOOK_URL`, `HERMES_WEBHOOK_SECRET`, and `HERMES_CHAT_ID`.
3. Remember that the first successful poll seeds existing results silently
   unless `NOTIFY_EXISTING_ON_FIRST_RUN=true`.
4. Confirm the search filters still return results on Daft.ie.

### The container is unhealthy

- Wait through the 120-second startup period.
- Run the healthcheck manually and inspect the heartbeat path.
- Confirm `/data` is writable and the state volume is mounted.
- If polling takes longer than expected, increase `HEALTHCHECK_MAX_AGE_SECONDS`
  or reduce the number of pages.

### Browser connection errors

- For bundled Chromium, leave `BROWSER_MODE=auto` and remove an obsolete
  `PLAYWRIGHT_WS_ENDPOINT`.
- For an external browser, use `BROWSER_MODE=external`, a `ws://` or `wss://`
  endpoint, and a hostname reachable from inside the monitor container.
- Use `CHROMIUM_NO_SANDBOX=true` only when the runtime requires it.

### Notifications are duplicated

Keep the `/data` volume across restarts. If more than one instance runs, use
one shared Postgres database and Redis lease as described in
[Choose where state is stored](#choose-where-state-is-stored).

### Startup rejects an environment variable

Configuration is validated before polling starts. Check allowed values, integer
ranges, min/max ordering, date format (`YYYY-MM-DD`), URL schemes, and the
`any` rules for property and media types.

## Privacy and security

- The monitor reads public Daft listing pages and sends selected listing data
  and the Daft link to your configured notification backend.
- Listing IDs and timestamps are stored in SQLite or Postgres so notifications
  are not repeated.
- Shoutrrr, Hermes, Postgres, Redis, and browser credentials are supplied
  through environment variables. Keep env files, webhook secrets, and
  notification URLs private.
- The container exposes no inbound application port. External services must be
  reachable from the container's network.
