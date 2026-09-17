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
coverage suite. Tests are bundled with the already-used esbuild package and
executed by Node's native test runner; no TypeScript runtime loader is needed.
The local hooks also run staged Gitleaks scanning before commits and
full-history Gitleaks scanning before pushes.

Useful focused commands:

```bash
npm test
npm run coverage
npm run mutation
npm run scan:secrets
npm run scan:secrets:staged
```

## Socket supply-chain controls

The pull-request and push validation workflows install JavaScript
dependencies through Socket Firewall Free. The action is pinned to the
Socket-provided `v1.3.2` commit, and the CI commands use the explicit
`sfw npm ...` wrapper.

To use the same protection locally:

```bash
npm install --global sfw
sfw npm ci --legacy-peer-deps
```

Socket Firewall Free requires no API key. It protects network downloads from
confirmed malicious packages; packages already present in a local npm cache
are not downloaded again and therefore cannot be filtered.

The `socket-security.yml` workflow runs Socket's dependency policy scan on
same-repository pull requests, `master` pushes, and manual dispatches. It
installs the pinned Socket CLI through the firewall and runs `socket ci`, which
waits for the scan report and fails when the configured Socket security or
license policy rejects the dependency set.

Configure the repository secret `SOCKET_SECURITY_API_KEY` with a Socket CI/CD
API key. The workflow warns and skips the policy scan when the secret is
absent. Set the repository variable `SOCKET_SECURITY_ENFORCE=true` to make a
missing key fail the workflow. Forked pull requests are skipped because GitHub
does not expose repository secrets to them.

Socket's basic scan evaluates dependency manifests and lockfiles; it does not
replace the repository's Gitleaks/PII scan or application tests. The
`publish.yml` Docker build installs npm dependencies inside BuildKit, so the
runner-level `sfw` wrapper does not transparently wrap those internal Docker
network requests. The Socket policy scan still evaluates the repository
manifests. Firewall coverage inside Docker builds requires Socket Firewall
Enterprise registry/proxy deployment.

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

## Alchemy deployment

`alchemy.run.ts` is the infrastructure definition. Alchemy builds the Docker
image from `Dockerfile`, creates the persistent state volume, creates the
healthchecked monitor container, and can target a remote Docker Engine over SSH.

Install dependencies, set the required runtime configuration, then preview and
apply the deployment:

```bash
npm ci --legacy-peer-deps
export SHOUTRRR_URL=ntfy://ntfy.sh/bellwatch
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

- `pull-request.yml` runs Gitleaks, Socket Firewall Free, and changed-file
  validation for pull requests.
- `push.yml` runs Gitleaks, Socket Firewall Free, and changed-file validation
  for `master` pushes.
- `socket-security.yml` runs the Socket dependency policy scan when the Socket
  API key is configured.
- `publish.yml` builds and publishes the multi-architecture Docker image after
  a successful `master` push workflow trigger.

Keep runtime secrets in GitHub Actions secrets or the deployment environment,
not in the repository, Dockerfile, image labels, or README examples.
