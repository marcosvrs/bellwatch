FROM node:22-bookworm-slim AS build
ARG TARGETARCH
ARG SHOUTRRR_VERSION=0.21.0

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund
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
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm ci --omit=dev --legacy-peer-deps --ignore-scripts --no-audit --no-fund

# The pinned Playwright image supplies Chromium and its Linux dependencies.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /usr/local/bin/shoutrrr /usr/local/bin/shoutrrr

RUN mkdir -p /data \
  && chown -R pwuser:pwuser /app /data

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

USER pwuser
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 CMD ["node", "dist/healthcheck.js"]
CMD ["node", "dist/main.js"]
