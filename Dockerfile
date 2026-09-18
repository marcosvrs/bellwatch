FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS dependencies
ARG TARGETARCH
ARG SHOUTRRR_VERSION=0.21.0

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci \
  --legacy-peer-deps \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  --fetch-retries=5 \
  --fetch-retry-factor=2 \
  --fetch-retry-mintimeout=1000 \
  --fetch-retry-maxtimeout=60000 \
  --fetch-timeout=120000
RUN apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates curl \
  && case "${TARGETARCH}" in \
    amd64) \
      shoutrrr_asset="shoutrrr_linux_amd64_${SHOUTRRR_VERSION}.tar.gz" \
      shoutrrr_checksum="e3eca9946e8aaa08817299d39fbb00b5f377023f51c9a252c45df4b3df523857" \
      ;; \
    arm64) \
      shoutrrr_asset="shoutrrr_linux_arm64v8_${SHOUTRRR_VERSION}.tar.gz" \
      shoutrrr_checksum="fcbd188091df60e92a2726070ec2b93954b216a64ccb5b2103a1167d13b14264" \
      ;; \
    *) echo "Unsupported target architecture: ${TARGETARCH}" >&2; exit 1 ;; \
  esac \
  && curl --fail --silent --show-error --location \
    "https://github.com/nicholas-fedor/shoutrrr/releases/download/v${SHOUTRRR_VERSION}/${shoutrrr_asset}" \
    --output /tmp/shoutrrr.tar.gz \
  && printf '%s  /tmp/shoutrrr.tar.gz\n' "${shoutrrr_checksum}" | sha256sum --check --strict \
  && tar --extract --gzip --file /tmp/shoutrrr.tar.gz --directory /usr/local/bin shoutrrr \
  && chmod 0755 /usr/local/bin/shoutrrr \
  && test -x /usr/local/bin/shoutrrr \
  && rm -f /tmp/shoutrrr.tar.gz \
  && rm -rf /var/lib/apt/lists/*

FROM dependencies AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
  && node_modules/.bin/esbuild src/main.ts \
    --bundle \
    --format=esm \
    --minify \
    --platform=node \
    --target=node22 \
    --external:playwright-core \
    --external:postgres \
    --outfile=dist/main.js \
  && find dist -type f -name '*.map' -delete

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci \
  --omit=dev \
  --legacy-peer-deps \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  --fetch-retries=5 \
  --fetch-retry-factor=2 \
  --fetch-retry-mintimeout=1000 \
  --fetch-retry-maxtimeout=60000 \
  --fetch-timeout=120000
RUN test ! -e node_modules/@redis/client \
  && test ! -e node_modules/effect \
  && test ! -e node_modules/tsx \
  && test ! -e node_modules/typescript

# The pinned Playwright image supplies Chromium and its Linux dependencies.
FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27 AS runtime

WORKDIR /app
LABEL org.opencontainers.image.title="Bellwatch" \
      org.opencontainers.image.licenses="MIT-0" \
      org.opencontainers.image.source="https://github.com/marcosvrs/bellwatch"
COPY --chown=pwuser:pwuser LICENSE ./LICENSE
COPY --chown=pwuser:pwuser THIRD_PARTY_NOTICES ./THIRD_PARTY_NOTICES
COPY --from=production-dependencies --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /app/dist/main.js ./dist/main.js
COPY --from=build --chown=pwuser:pwuser /app/dist/healthcheck.js ./dist/healthcheck.js
COPY --from=build /usr/local/bin/shoutrrr /usr/local/bin/shoutrrr

RUN mkdir -p /data \
  && chown pwuser:pwuser /data

ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=256 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

USER pwuser
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 CMD ["node", "dist/healthcheck.js"]
CMD ["node", "dist/main.js"]
