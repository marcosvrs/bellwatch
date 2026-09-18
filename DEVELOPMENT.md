# Development and release guide

This file is for maintainers and operators of the repository. End users should
follow [`README.md`](README.md): it uses the published Docker image from GitHub
Container Registry and does not require a repository checkout.

## Local checks

Requirements:

- Node.js 22.23.2; use the checked-in `.node-version` with a version manager;
- npm bundled with that Node.js release;
- Gitleaks (`brew install gitleaks` on macOS);
- an internet connection for dependency installation and browser/image pulls.

Install dependencies and run the full project check:

```bash
npm cache verify
npm ci --legacy-peer-deps --ignore-scripts
npm run prepare
npm run security:local
npm run check
```

The check runs TypeScript typechecking, the production build, and the test
coverage suite. Tests are bundled with the already-used esbuild package and
executed by Node's native test runner; no TypeScript runtime loader is needed.
The mutation check enforces a 99% score across the configured source files.
The local hooks also run staged Gitleaks scanning before commits and
full-history Gitleaks scanning before pushes.
The checked-in `.npmrc` pins npm to `registry.npmjs.org` and disables
dependency lifecycle scripts. Keep `--ignore-scripts` on installs, including
installs of tools from an untrusted or newly changed dependency graph. Run
`npm run prepare` explicitly only after reviewing the repository; it installs
the tracked Git hooks and does not execute dependency lifecycle scripts.

Do not use `npx <package>` in a repository unless the package is already in the
lockfile and installed. Prefer `npm exec --offline -- <local-command>` so npm
cannot silently download a missing executable.

Useful focused commands:

```bash
npm test
npm run coverage
npm run mutation
npm run security:deps
npm run security:local
npm run scan:secrets
npm run scan:secrets:staged
```


Dependabot is configured to keep npm dependencies and GitHub Actions current.
Actions used as security controls remain pinned to immutable commit SHAs.

## Local container smoke test

Local image builds are for development and testing only. Production users pull
the published GHCR image documented in `README.md`.

On macOS, the repository's local container smoke test uses Apple's `container`
CLI:

```bash
container system start
container build -t bellwatch:local .
```

Run the resulting image with a private env file and a persistent `/data` volume.
The image installs the pinned Shoutrrr CLI used for notification delivery. Do
not commit the env file. The image's healthcheck is defined in `Dockerfile`.

## Production image e2e test

This test runs the production image, uses its bundled Chromium, performs the
same first Daft poll as the deployed monitor, and fails on a poll error or
timeout. It requires outbound access to `www.daft.ie`; it does not send
notifications or reuse persistent state.

Run it after building an image:

```bash
container system start
container build -t bellwatch:e2e .
CONTAINER_CLI=container E2E_IMAGE=bellwatch:e2e npm run e2e
```

On Linux with Docker, set `CONTAINER_CLI=docker` instead. The image publication
workflow runs this e2e check against a loaded `linux/amd64` image before it
publishes the multi-architecture tags.

## Alchemy deployment

`alchemy.run.ts` is the infrastructure definition. Alchemy builds the Docker
image from `Dockerfile`, creates the persistent state volume, creates the
healthchecked monitor container, and can target a remote Docker Engine over SSH.

Install dependencies, verify them, set the required runtime configuration, then
preview and apply the deployment:

```bash
npm ci --legacy-peer-deps --ignore-scripts
npm run prepare
npm run security:deps
export SHOUTRRR_URL=ntfy://ntfy.sh/bellwatch
export ALCHEMY_DOCKER_HOST='host=ssh://user@remote-host'
export MONITOR_DOCKER_NETWORK='the-existing-browser-network'
export PLAYWRIGHT_WS_ENDPOINT='ws://browser-sockpuppet-chrome:3000/?--window-size=1920,1080'

npm exec --offline -- alchemy plan
npm exec --offline -- alchemy deploy
```

Omit `ALCHEMY_DOCKER_HOST` for the default local Docker target. The target
engine must be able to build the Dockerfile and reach the configured external
services. Use `npm exec --offline -- alchemy deploy --adopt` only after
inspecting the plan and confirming that an existing state volume is the
intended one. `--offline` prevents npm from resolving an uninstalled package
from the network.

Resource names can be changed with:

- `ALCHEMY_DOCKER_CONTEXT_NAME`;
- `MONITOR_IMAGE_NAME` and `MONITOR_IMAGE_TAG`;
- `MONITOR_CONTAINER_NAME`;
- `MONITOR_VOLUME_NAME`.

`npm exec --offline -- alchemy destroy` is destructive: it removes the managed
container, image, and volume, including listing history.

## GitHub Container Registry publishing

The `Publish Docker image` workflow builds the repository's `Dockerfile` in
GitHub Actions and publishes the result to:

```text
ghcr.io/marcosvrs/bellwatch:latest
```

A push to `master` publishes `latest` and a commit-specific SHA tag. The build
publishes `linux/amd64` and `linux/arm64` images so the same reference works on
common server and Apple-hosted Docker installations. GitHub Actions uses the
repository `GITHUB_TOKEN` with `packages: write`; no personal token is stored in
the repository.

The package must be visible to the users who pull it. If the GitHub package is
private, users and deployment engines need GitHub Container Registry read
credentials before `docker pull` or Alchemy deployment.

## GitHub Actions overview

- `pull-request.yml` runs Gitleaks and changed-file validation for pull requests.
- `push.yml` runs Gitleaks and changed-file validation for `master` pushes.
- `publish.yml` builds and publishes the multi-architecture Docker image after
  a successful `master` push workflow trigger.

Keep runtime secrets in GitHub Actions secrets or the deployment environment,
not in the repository, Dockerfile, image labels, or README examples.
