# Development and release guide

This file is for maintainers and operators of the repository. End users should
follow [`README.md`](README.md): it uses the published Docker image from GitHub
Container Registry and does not require a repository checkout.

## Local checks

Requirements:

- Node.js 22 or newer;
- npm;
- Gitleaks (`brew install gitleaks` on macOS);
- an internet connection for dependency installation and browser/image pulls.

Install dependencies and run the full project check:

```bash
npm ci --legacy-peer-deps
npm run check
```

The check runs TypeScript typechecking, the production build, and the test
coverage suite. The local hooks also run staged Gitleaks scanning before commits
and full-history Gitleaks scanning before pushes.

Useful focused commands:

```bash
npm test
npm run coverage
npm run mutation
npm run scan:secrets
npm run scan:secrets:staged
```

## Local container smoke test

Local image builds are for development and testing only. Production users pull
the published GHCR image documented in `README.md`.

On macOS, the repository's local container smoke test uses Apple's `container`
CLI:

```bash
container system start
container build -t daft-house-search:local .
```

Run the resulting image with a private env file and a persistent `/data` volume.
Do not commit the env file. The image's healthcheck is defined in `Dockerfile`.

## Alchemy deployment

`alchemy.run.ts` is the infrastructure definition. Alchemy builds the Docker
image from `Dockerfile`, creates the persistent state volume, creates the
healthchecked monitor container, and can target a remote Docker Engine over SSH.

Install dependencies, set the required runtime configuration, then preview and
apply the deployment:

```bash
npm ci --legacy-peer-deps
export NTFY_URL=https://ntfy.example/daft-house-search
export ALCHEMY_DOCKER_HOST='host=ssh://user@remote-host'
export MONITOR_DOCKER_NETWORK='the-existing-browser-network'
export PLAYWRIGHT_WS_ENDPOINT='ws://browser-sockpuppet-chrome:3000/?--window-size=1920,1080'

npx alchemy plan
npx alchemy deploy
```

Omit `ALCHEMY_DOCKER_HOST` for the default local Docker target. The target
engine must be able to build the Dockerfile and reach the configured external
services. Use `npx alchemy deploy --adopt` only after inspecting the plan and
confirming that an existing state volume is the intended one.

Resource names can be changed with:

- `ALCHEMY_DOCKER_CONTEXT_NAME`;
- `MONITOR_IMAGE_NAME` and `MONITOR_IMAGE_TAG`;
- `MONITOR_CONTAINER_NAME`;
- `MONITOR_VOLUME_NAME`.

`npx alchemy destroy` is destructive: it removes the managed container, image,
and volume, including listing history.

## GitHub Container Registry publishing

The `Publish Docker image` workflow builds the repository's `Dockerfile` in
GitHub Actions and publishes the result to:

```text
ghcr.io/marcosvrs/daft-house-search:latest
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
- `publish.yml` builds and publishes the multi-architecture Docker image after a
  successful `master` push workflow trigger.

Keep runtime secrets in GitHub Actions secrets or the deployment environment,
not in the repository, Dockerfile, image labels, or README examples.
