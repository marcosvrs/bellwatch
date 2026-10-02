---
name: bellwatch
description: Help users set up, configure, run, and troubleshoot Bellwatch, the Irish Daft.ie and MyHome property-listing monitor. Use when choosing search areas or filters, configuring notifications, deploying the service, checking alerts or health, or safely updating its container.
---

# Bellwatch: user setup and operation

Help the user get Bellwatch monitoring the listings they want and delivering alerts safely. This is a user-operation guide, not a contributor or code-development guide. Installing this skill installs instructions for an AI agent; it does not install or start Bellwatch.

## Before configuring

1. Establish the user's deployment target, search (sale, rent, or new homes; locations and filters), and notification destination.
2. Use Docker for normal deployments of the official Bellwatch image; the image and documented Compose deployment target Docker and are tested with Docker. Prefer standalone `docker run` for a small deployment: it includes Chromium, Shoutrrr, and SQLite. Use Compose when the user needs the separate Browserless service or PostgreSQL profile. Apple's `container` CLI is for development and testing only; do not recommend it for a user's production or ordinary app deployment.
3. Keep the current project README as the source of truth for detailed or newly added settings: <https://github.com/marcosvrs/bellwatch/blob/master/README.md>.
4. Never ask the user to paste notification URLs, webhook secrets, tokens, or other credentials into chat. Have them enter secrets directly into a private local environment file or a deployment secret store. Do not commit the file.

## Configure notifications and search

At least one complete notification backend is required:

- Shoutrrr: set `SHOUTRRR_URL` to a supported service URL. Example: `ntfy://ntfy.sh/<long-random-topic>`. Treat an ntfy topic as a bearer address; choose an unguessable value and avoid sending sensitive personal information in alerts.
- Hermes: set all three `HERMES_WEBHOOK_URL`, `HERMES_WEBHOOK_SECRET`, and `HERMES_CHAT_ID`. A partial Hermes configuration is rejected.
- Both complete backends may be configured; Bellwatch sends to both.

Start from the user's desired search. Defaults are `DAFT_SECTION_PATH=new-homes-for-sale`, nationwide Daft searches, no configured price cap, and `SHPS_FILTER=off`. The catalog only includes individual houses with at least three bedrooms; apartments, duplexes, and parent-only development results are excluded. MyHome is enabled by default. The default poll schedule is every eight hours, and a poll starts immediately at startup.

Common environment settings:

| Goal | Variables / examples |
| --- | --- |
| Choose the section | `DAFT_SECTION_PATH=new-homes-for-sale`, `property-for-sale`, or `property-for-rent` |
| Limit geography | `DAFT_LOCATION=dublin-city` or comma-separated Daft location slugs; unset means nationwide |
| Set price and beds | `DAFT_PRICE_MIN_EUR`, `DAFT_PRICE_MAX_EUR`, `DAFT_BEDS_MIN`, `DAFT_BEDS_MAX` |
| Choose property type | `DAFT_PROPERTY_TYPES=houses` or supported comma-separated values |
| Add a keyword or age limit | `DAFT_KEYWORD`, `DAFT_ADDED_IN_LAST_DAYS` |
| Set cadence/timezone | `POLL_CRON` (default `0 */8 * * *`) and `TZ` (for example `Europe/Dublin`) |
| Disable MyHome | `MYHOME_ENABLED=false` |
| Control first-run alerts | `NOTIFY_EXISTING_ON_FIRST_RUN=true` only if the user explicitly wants current matches notified |

Use only filters supported by the selected profile. Sale, rental, and new-home sections have different options; see the README's Configuration section before adding less-common filters. `DAFT_REQUEST_DELAY_MS` cannot be set below 1,000 ms. Do not evade `robots.txt`, rate limits, or access blocks. An unsupported active filter makes MyHome skip that poll rather than broaden the search; records missing facts needed for a filter are excluded.

`SHPS_FILTER=only` and `exclude` are text-evidence filters for new-home searches, not legal eligibility decisions. Verify scheme eligibility with the relevant scheme and local authority. The €500,000 Help to Buy valuation ceiling is not a default purchase-price cap.

## Standalone setup with Docker

Use the official image `ghcr.io/marcosvrs/bellwatch:latest`. The following creates a private environment file, persists SQLite and heartbeat state in a named Docker volume, and starts the monitor. Replace the example topic locally; do not use a guessable topic for private alerts.

```sh
umask 077
mkdir -p "$HOME/.config/bellwatch"
cat > "$HOME/.config/bellwatch/monitor.env" <<'EOF'
SHOUTRRR_URL=ntfy://ntfy.sh/replace-with-a-long-random-topic
DAFT_SECTION_PATH=new-homes-for-sale
DAFT_LOCATION=dublin-city
DAFT_PROPERTY_TYPES=houses
# Optional, for example:
# DAFT_PRICE_MAX_EUR=450000
# TZ=Europe/Dublin
EOF
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

If `bellwatch-data` or a container named `bellwatch` already exists, inspect it first. Do not delete the data volume to resolve a name conflict. Keep the `/data` volume attached across restarts and upgrades. For Compose setup, existing PostgreSQL state, or image-digest verification, follow the matching README section. Apple `container` commands are for development/testing workflows only, not this user deployment path.

## Verify and operate

With Docker:

```sh
docker ps --filter name=bellwatch
docker logs --tail=100 bellwatch
docker exec bellwatch node dist/healthcheck.js
```

Use `docker logs --follow bellwatch` to watch live logs. The first poll runs immediately. By default, the first successful poll silently seeds current matches so it does not send a burst of old listings. Later polls follow `POLL_CRON`; successful searches with no matches are not errors.

Changing environment settings requires recreating the container with the updated env file. Preserve and reattach the same `/data` volume. For upgrades, prefer a verified image digest in production; never remove the state volume as part of an ordinary update. Confirm the health check and logs after changing the image or configuration.


## Troubleshoot common issues

- **Container exits at startup:** inspect logs for configuration errors. Check that one notification backend is complete, values are valid for the selected section, and minimums do not exceed maximums.
- **No first-run alert:** this is expected unless `NOTIFY_EXISTING_ON_FIRST_RUN=true`; Bellwatch normally seeds existing matches silently. Check search scope, filters, and poll logs before changing notification settings.
- **No results or one source is skipped:** a successful empty result is not an error. Check location slugs and profile-specific filters. MyHome can skip a poll when it cannot apply an active filter safely.
- **Stale health check:** verify the container is running, `/data` remains persistent and writable, and logs show a completed poll. The health check uses the heartbeat in `/data`.
- **Request blocked or rate-limited:** do not increase request frequency or bypass the block. Respect the site's rules and retry only through a later scheduled poll.
- **Possible duplicate/missing notification:** inspect the poll and notification logs first. Bellwatch marks findings seen only after delivery succeeds; changing or deleting its state can cause re-alerts or loss of history.

## User boundaries

Bellwatch monitors public listing information; it does not contact estate agents, submit applications, reserve properties, or determine eligibility for a housing scheme. Do not promise that a listing is available or that a user qualifies based on an alert. Keep state volumes when stopping or upgrading; delete them only when the user explicitly requests removal of listing history.

To install this guide into an agent workspace, use `npx skills add marcosvrs/bellwatch`. This command installs the skill, not the Bellwatch service.
