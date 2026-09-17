# Bellwatch

Bellwatch watches a configurable Daft.ie search section and sends a
notification when a new matching listing or unit appears. It keeps listing
history in persistent storage, so restarts do not resend the same listings.

It is a background container, not a website: there is no web UI or inbound
application port. The container needs outbound access to Daft.ie, the configured
notification service(s), and any optional browser or database service.

> **Legal notice**
>
> Bellwatch is an independent, unofficial project. It is not affiliated with,
> endorsed by, sponsored by, or authorized by Daft.ie, Daft Media Limited, or
> their affiliates.
>
> Bellwatch is provided “as is”. To the fullest extent permitted by law, the
> owner and contributors accept no responsibility or liability for how it is
> used, for automated access to third-party services, for notification accuracy
> or delivery, or for decisions made from its output. Users are solely
> responsible for lawful use, permissions, third-party terms, credentials, rate
> limits, privacy, and data protection. Review [Daft.ie’s current terms](https://www.daft.ie/legal/)
> before running the application.

## What you need

- At least one notification backend:
  - Shoutrrr URL, such as ntfy, Discord, Gotify, or Slack; or
  - Hermes webhook URL, secret, and WhatsApp chat ID.
- Writable storage mounted at `/data`; persist it for SQLite history. When
  `DATABASE_URL` is set, `/data` only needs to support heartbeat writes.
- Optional: Postgres for shared/external state, or a Playwright/CDP endpoint.

## Quick start: one container

This uses the published image and the Chromium bundled in it.

### 1. Create an environment file

Keep this file private. It contains notification credentials.

```bash
umask 077
mkdir -p "$HOME/.config/bellwatch"
cat > "$HOME/.config/bellwatch/monitor.env" <<'EOF'
SHOUTRRR_URL=ntfy://ntfy.sh/replace-with-a-random-topic

# Optional search, request pacing, and schedule overrides:
# DAFT_LOCATION=galway-city
# DAFT_SECTION_PATH=new-homes-for-sale
# DAFT_PRICE_MAX_EUR=450000
# DAFT_REQUEST_DELAY_MS=1000
# TZ=Europe/Dublin
# POLL_CRON=0 */8 * * *
EOF
```

For Hermes instead, use:

```dotenv
HERMES_WEBHOOK_URL=http://hermes:8644/webhooks/ha-notify
HERMES_WEBHOOK_SECRET=replace-with-the-webhook-secret
HERMES_CHAT_ID=replace-with-the-WhatsApp-chat-id
```

### 2. Pull and start the container

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

### 3. Check the container

```bash
docker ps --filter name=bellwatch
docker logs --follow bellwatch
```

A healthy container has a recent heartbeat. The image healthcheck runs
automatically; run it manually with:

```bash
docker exec bellwatch node dist/healthcheck.js
```

## Docker Compose

The included [`docker-compose.yml`](docker-compose.yml) starts:

- Bellwatch;
- Postgres for listing history; and
- Browserless Chromium for the monitor's browser connection.

Use it when you want those services managed together. It does not use the
image's bundled Chromium.

```bash
cp .env.example .env
# Set POSTGRES_PASSWORD and BROWSERLESS_TOKEN in .env.
# Set SHOUTRRR_URL and/or the three required HERMES_* variables.
docker compose pull
docker compose up --detach
docker compose logs --follow bellwatch
```

`POSTGRES_PASSWORD` and `BROWSERLESS_TOKEN` are Compose-only service
credentials; Bellwatch receives the resulting `DATABASE_URL` and
`PLAYWRIGHT_WS_ENDPOINT`.

The Compose stack creates `bellwatch-data` for Bellwatch's `/data` directory
(heartbeat and the SQLite fallback) and `postgres-data` for Postgres listing
history. This stack sets `DATABASE_URL`, so listing history lives in Postgres;
the Bellwatch volume still provides the writable heartbeat path. `docker
compose down` keeps both volumes; do not add `--volumes` unless you want to
delete listing history.

For Compose, uncomment the search, polling, and browser override entries you
want in `docker-compose.yml`; the standalone `docker run` example passes the
env file directly to Bellwatch.

## Defaults and expected behavior

The default search is:

- Daft's `new-homes-for-sale` section;
- the whole Ireland search;
- all property types, bedroom counts, and radius distances;
- maximum price €499,999;
- published listings; and
- all result pages.

Search URLs always use `/<DAFT_SECTION_PATH>/ireland`. Location filters are
repeated `location` query parameters, not path segments. Results from multiple
locations are combined and de-duplicated. Configuration is validated before
polling starts; an invalid value stops the container with a configuration
error.

The first poll runs immediately. Existing results are seeded silently unless
`NOTIFY_EXISTING_ON_FIRST_RUN=true`.

Notifications contain the listing title, price, bedrooms, bathrooms, property
type, development, and Daft URL. A listing is marked seen only after every
configured notification backend accepts it. If one backend fails, it can be
sent again on a later poll.

Poll failures, including Daft responses other than HTTP 200 and browser,
parser, state, or notification-cycle errors, are sent through every configured
notification backend. A successful search with no results is not an error.

The persistent state stores only listing IDs and first/last-seen timestamps;
listing descriptions, images, advertiser details, and page content are not
stored. IDs and timestamps remain until the state file or database is deleted;
this is the minimum history needed to suppress duplicate alerts.

## Configuration

Put variables in the env file passed to the container. Recreate the container
after changing them.

### Notifications

Bellwatch detects notification backends from their required variables. Set
`SHOUTRRR_URL` to enable Shoutrrr. Set all three `HERMES_*` variables
(`HERMES_WEBHOOK_URL`, `HERMES_WEBHOOK_SECRET`, and `HERMES_CHAT_ID`) to enable
Hermes. Set both complete configurations to send every notification to both
backends. At least one backend is required; a partial Hermes configuration is
rejected.

| Variable | Default | Required when | Result |
| --- | --- | --- | --- |
| `SHOUTRRR_URL` | — | Shoutrrr is enabled | Complete Shoutrrr service URL. |
| `HERMES_WEBHOOK_URL` | — | Hermes is enabled | Hermes webhook endpoint. |
| `HERMES_WEBHOOK_SECRET` | — | Hermes is enabled | Signs Hermes requests. |
| `HERMES_CHAT_ID` | — | Hermes is enabled | WhatsApp chat or group ID. |

### Search

| Variable | Default | Accepted values / result |
| --- | --- | --- |
| `DAFT_LOCATION` | unset | Comma-separated location slugs sent as repeated `location` query parameters; unset searches all Ireland. |
| `DAFT_SECTION_PATH` | `new-homes-for-sale` | Daft section path before `/ireland`. |
| `DAFT_PRICE_MIN_EUR` | unset | Non-negative euro amount. |
| `DAFT_PRICE_MAX_EUR` | `499999` | Non-negative euro amount. |
| `DAFT_BEDS_MIN`, `DAFT_BEDS_MAX` | unset | Integer `0`–`15`. |
| `DAFT_BATHS_MIN`, `DAFT_BATHS_MAX` | unset | Integer `1`–`5`. |
| `DAFT_RADIUS_KM` | unset | `0`, `1`, `3`, `5`, `10`, or `20`; unset means no radius restriction. |
| `DAFT_PROPERTY_TYPES` | unset | Comma-separated Daft types, or `any`; unset means all types. |
| `DAFT_MEDIA_TYPES` | unset | `video`, `virtual-tour`, or `any`; unset means any. |
| `DAFT_KEYWORD` | unset | Keyword or address, up to 50 characters. |
| `DAFT_AVAILABILITY` | `published` | `published` or `sale-agreed`. |
| `DAFT_ADDED_IN_LAST_DAYS` | unset | `0`, `1`, `3`, `7`, `14`, or `30`; unset means any age. |
| `DAFT_OPEN_VIEWINGS_FROM` | unset | Date in `YYYY-MM-DD` format. |
| `DAFT_SORT` | Daft default | `bestMatch`, `publishDateDesc`, `priceAsc`, or `priceDesc`. |
| `DAFT_MAX_PAGES` | unset | Integer `1`–`20`; unset means all result pages. |
| `DAFT_REQUEST_DELAY_MS` | `1000` | Minimum milliseconds between browser navigations to Daft; `1000`–`60000`. |

For example:

```dotenv
DAFT_LOCATION=dublin-city,drogheda-and-surrounds-louth
DAFT_PROPERTY_TYPES=houses
```

This produces a URL shaped like:

```text
https://www.daft.ie/new-homes-for-sale/ireland/houses?location=dublin-city&location=drogheda-and-surrounds-louth
```

The Daft base URL, `/ireland` scope, browser and notification timeouts,
Shoutrrr executable/title, and `/data` state/heartbeat paths are fixed
application defaults; they are not environment variables.

Requests matching a `robots.txt` disallow rule fail rather than being
rewritten to evade it.

Property types accept `houses`, `detached-houses`, `semi-detached-houses`,
`terraced-houses`, `end-of-terrace-houses`, `townhouses`, `apartments`,
`studio-apartments`, `duplexes`, `bungalows`, or `any`. Use `any` alone; do
not combine it with specific values.

### SHPS filtering

`SHPS_FILTER` is optional and defaults to `off`.

| Value | Result |
| --- | --- |
| `off` | Keep all matching listings. |
| `only` | Keep listings with proven SHPS-only evidence; uncertain listings are removed. |
| `exclude` | Remove only listings proven to be SHPS-only; keep uncertain listings. |

`only` and `exclude` fetch each listing's detail page. This is a text filter,
not a legal eligibility check; verify eligibility with the relevant scheme and
local authority.

### Polling

| Variable | Default | Result |
| --- | --- | --- |
| `POLL_CRON` | `0 */8 * * *` | Polls at `00:00`, `08:00`, and `16:00`. Five- or six-field crontab syntax is accepted. |
| `TZ` | Detected runtime timezone | Timezone used for `POLL_CRON`. Direct host runs detect the host timezone. Containers need `TZ` passed explicitly if they should use the host timezone. |
| `NOTIFY_EXISTING_ON_FIRST_RUN` | `false` | Sends current results on the first poll instead of silently seeding them. |

### Browser

The monitor launches the bundled Chromium by default. Set
`PLAYWRIGHT_WS_ENDPOINT` only when an external Playwright/CDP service should
handle browser work.

| Variable | Default | Dependency / result |
| --- | --- | --- |
| `PLAYWRIGHT_WS_ENDPOINT` | unset | Connects to an external browser; must be `ws://` or `wss://`. |
| `BROWSER_USER_AGENT` | unset | Optional browser user-agent string. |

### State and health

| Variable | Default | Dependency / result |
| --- | --- | --- |
| `DATABASE_URL` | unset | Optional Postgres state backend. Compose sets this automatically. |
| `HEALTHCHECK_MAX_AGE_SECONDS` | `86400` | Maximum heartbeat age. Increase it for sparse cron schedules. |

With `DATABASE_URL`, listing history is stored in Postgres and SQLite is not
opened. The container still writes `/data/heartbeat` for the healthcheck, so
`/data` must be writable, but its persistence is not required for listing
history. Without `DATABASE_URL`, SQLite state is stored at
`/data/state.sqlite`; persist `/data` across restarts.

## Operate and update

Stop and start without losing state:

```bash
docker stop bellwatch
docker start bellwatch
```

The process handles `SIGINT` and `SIGTERM`, stops polling, and closes its
persistent state before exiting.

Replace the container while keeping the volume:

```bash
docker stop bellwatch
docker rm bellwatch
docker pull ghcr.io/marcosvrs/bellwatch:latest
docker run --detach \
  --name bellwatch \
  --restart unless-stopped \
  --env-file "$HOME/.config/bellwatch/monitor.env" \
  --volume bellwatch-data:/data \
  ghcr.io/marcosvrs/bellwatch:latest
```

In SQLite mode, delete `bellwatch-data` only when you intentionally want all
current listings treated as new. In Postgres mode, deleting it resets only the
heartbeat directory; delete Postgres data separately if you intend to reset
listing history.

```bash
docker volume rm bellwatch-data
```

## Troubleshooting

- **No listing notification:** the first poll is silent by default, and a
  successful search with no results is not an error. Check
  `NOTIFY_EXISTING_ON_FIRST_RUN`, the backend variables, and
  `docker logs bellwatch`.
- **Poll error:** HTTP responses other than 200, browser/network failures,
  parser failures, and state failures are sent through every configured
  notification backend and logged. Inspect `docker logs bellwatch` for the
  underlying error.
- **Unhealthy container:** confirm `/data` is writable. Persist it for SQLite
  history; Postgres users only need the heartbeat path. Raise
  `HEALTHCHECK_MAX_AGE_SECONDS` if the cron schedule is less frequent than the
  default.
- **Browser connection error:** remove an obsolete endpoint for bundled
  Chromium, or make the external `ws://`/`wss://` endpoint reachable from the
  monitor container.
- **Duplicate notifications after restart:** restore the original `/data`
  volume in SQLite mode, or restore the Postgres database.
- **Startup configuration error:** check the variable's accepted values and
  dependency requirements above.

## Privacy and security

Bellwatch reads public Daft.ie pages and sends listing details and URLs to your
selected notification backend. Credentials, webhook secrets, service URLs, and
listing history should be treated as private. It fetches and applies the target
origin's `robots.txt` rules; failure to retrieve that policy fails closed,
while a missing `robots.txt` is treated as no rules. Browser navigations are
paced by at least one second by default.
Bellwatch does not log in to Daft.ie, bypass access controls, solve CAPTCHAs,
or use a proxy to evade blocking. Request pacing or robots compliance does
not grant permission to automate access; review the current third-party terms
before running it.

## Contact and removal requests

For non-sensitive bugs, compliance questions, or removal requests, use the
[repository issue tracker](https://github.com/marcosvrs/bellwatch/issues).
Do not include credentials, personal data, or private listing information in a
public issue. For sensitive requests, contact the repository owner through
their [GitHub profile](https://github.com/marcosvrs) instead.

## License

Bellwatch is released under [MIT-0](LICENSE). This license applies only to
Bellwatch; it does not grant rights to Daft.ie, its content, or any other
third-party service. Direct runtime dependency notices are in
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES); their licenses remain separate.
