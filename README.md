# Bellwatch

Bellwatch watches a Daft.ie new-homes search and sends a notification when a
new matching listing appears. It keeps listing history in persistent storage,
so restarts do not resend the same homes.

It is a background container, not a website: there is no web UI or inbound
application port. The container needs outbound access to Daft.ie, the selected
notification service, and any optional browser or database service.

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

- A Docker-compatible OCI runtime.
- A notification backend:
  - Shoutrrr URL, such as ntfy, Discord, Gotify, or Slack; or
  - Hermes webhook URL, secret, and WhatsApp chat ID.
- Persistent storage mounted at `/data`.
- Optional: Postgres for shared/external state, or a Playwright/CDP endpoint.

## Quick start: one container

This uses the published image and the Chromium bundled in it.

### 1. Create an environment file

Keep this file private. It contains notification credentials.

```bash
umask 077
mkdir -p "$HOME/.config/bellwatch"
cat > "$HOME/.config/bellwatch/monitor.env" <<'EOF'
NOTIFICATION_BACKEND=shoutrrr
SHOUTRRR_URL=ntfy://ntfy.sh/replace-with-a-random-topic

# Optional search, request pacing, and schedule overrides:
# DAFT_LOCATION_PATH=galway-city
# DAFT_PRICE_MAX_EUR=450000
# DAFT_REQUEST_DELAY_MS=1000
# TZ=Europe/Dublin
# POLL_CRON=0 */8 * * *
```

For Hermes instead, use:

```dotenv
NOTIFICATION_BACKEND=hermes
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
# Set SHOUTRRR_URL, or configure the HERMES_* variables.
docker compose pull
docker compose up --detach
docker compose logs --follow bellwatch
```

The Compose stack keeps Postgres data in a named volume. `docker compose down`
keeps the volumes; do not add `--volumes` unless you want to delete listing
history.

## Defaults and expected behavior

The default search is:

- Daft's `new-homes-for-sale` section;
- Dublin City Centre (`dublin-city-centre-dublin`);
- all property types, bedroom counts, and radius distances;
- maximum price €499,999;
- published listings; and
- all result pages.

Results from multiple locations are combined and de-duplicated. Configuration
is validated before polling starts; an invalid value stops the container with a
configuration error.
The first poll runs immediately. Existing results are seeded silently unless
`NOTIFY_EXISTING_ON_FIRST_RUN=true`.

Notifications contain the listing title, price, bedrooms, bathrooms, property
type, development, and Daft URL. A listing is marked seen only after the
notification service accepts it. If delivery fails, it can be sent again on a
later poll. The persistent state stores only listing IDs and first/last-seen
timestamps; listing descriptions, images, advertiser details, and page content
are not stored. IDs and timestamps remain until the state file or database is
deleted; this is the minimum history needed to suppress duplicate alerts.

## Configuration

Put variables in the env file passed to the container. Recreate the container
after changing them.

### Notifications

| Variable | Default | Required when | Result |
| --- | --- | --- | --- |
| `NOTIFICATION_BACKEND` | `shoutrrr` | — | Selects `shoutrrr` or `hermes`. |
| `SHOUTRRR_URL` | — | Backend is `shoutrrr` | Complete Shoutrrr service URL. |
| `HERMES_WEBHOOK_URL` | — | Backend is `hermes` | Hermes webhook endpoint. |
| `HERMES_WEBHOOK_SECRET` | — | Backend is `hermes` | Signs Hermes requests. |
| `HERMES_CHAT_ID` | — | Backend is `hermes` | WhatsApp chat or group ID. |
| `SHOUTRRR_BINARY` | `shoutrrr` | — | Shoutrrr executable or command. |
| `SHOUTRRR_TITLE_PREFIX` | `Bellwatch new home` | — | Notification title prefix where supported. |
| `SHOUTRRR_TIMEOUT_MS` | `15000` | — | Shoutrrr timeout; `1000`–`120000`. |
| `HERMES_TIMEOUT_MS` | `20000` | — | Hermes timeout per attempt; `1000`–`120000`. |

### Search

| Variable | Default | Accepted values / result |
| --- | --- | --- |
| `DAFT_LOCATION_PATH` | `dublin-city-centre-dublin` | Comma-separated Daft paths. Results are merged and de-duplicated. |
| `DAFT_SECTION_PATH` | `new-homes-for-sale` | Daft search section. |
| `DAFT_BASE_URL` | `https://www.daft.ie` | Alternate Daft-compatible origin; mainly useful for testing. |
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

The default `auto` mode uses an external endpoint when
`PLAYWRIGHT_WS_ENDPOINT` is set; otherwise it launches bundled Chromium.

| Variable | Default | Dependency / result |
| --- | --- | --- |
| `BROWSER_MODE` | `auto` | `auto`, `local`, or `external`. |
| `PLAYWRIGHT_WS_ENDPOINT` | unset | Required for `external`; must be `ws://` or `wss://`. |
| `CHROMIUM_EXECUTABLE_PATH` | bundled browser | Overrides the local Chromium executable. |
| `CHROMIUM_HEADLESS` | `true` | Controls local Chromium headless mode. |
| `CHROMIUM_NO_SANDBOX` | `false` | Use only when the runtime cannot use Chromium's sandbox. |
| `BROWSER_TIMEOUT_MS` | `60000` | Browser/navigation timeout; `1000`–`300000`. |
| `BROWSER_USER_AGENT` | unset | Optional browser user-agent string. |

### State and health

| Variable | Default | Dependency / result |
| --- | --- | --- |
| `STATE_FILE` | `/data/state.sqlite` | Used when `DATABASE_URL` is unset. Keep `/data` persistent. |
| `DATABASE_URL` | unset | Optional Postgres state backend. Compose sets this automatically. |
| `HEARTBEAT_FILE` | `/data/heartbeat` | Successful polls update this file. |
| `HEALTHCHECK_MAX_AGE_SECONDS` | `86400` | Maximum heartbeat age. Increase it for sparse cron schedules. |

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

Delete `bellwatch-data` only when you intentionally want all current listings
treated as new:

```bash
docker volume rm bellwatch-data
```

## Troubleshooting

- **No notification:** the first poll is silent by default; check the backend
  variables and `docker logs bellwatch`.
- **Unhealthy container:** confirm `/data` is writable and persistent. Raise
  `HEALTHCHECK_MAX_AGE_SECONDS` if the cron schedule is less frequent than the
  default.
- **Browser connection error:** remove an obsolete endpoint for bundled
  Chromium, or make the external `ws://`/`wss://` endpoint reachable from the
  monitor container.
- **Duplicate notifications after restart:** restore the original `/data`
  volume or Postgres database.
- **Startup configuration error:** check the variable's accepted values and
  dependency requirements above.

## Privacy and security

Bellwatch reads public Daft.ie pages and sends listing details and URLs to your
selected notification backend. Credentials, webhook secrets, service URLs, and
listing history should be treated as private. It fetches and applies the
target origin's `robots.txt` rules, fails closed if that policy cannot be
retrieved, and paces browser navigations by at least one second by default.
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
