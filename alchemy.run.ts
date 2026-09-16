import * as Alchemy from "alchemy";
import * as Docker from "alchemy/Docker";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";

const RUNTIME_ENVIRONMENT_KEYS = [
  "DAFT_BASE_URL",
  "DAFT_SECTION_PATH",
  "DAFT_LOCATION_PATH",
  "DAFT_RADIUS_KM",
  "DAFT_PRICE_MIN_EUR",
  "DAFT_PRICE_MAX_EUR",
  "DAFT_BEDS_MIN",
  "DAFT_BEDS_MAX",
  "DAFT_PROPERTY_TYPES",
  "DAFT_BATHS_MIN",
  "DAFT_BATHS_MAX",
  "DAFT_MEDIA_TYPES",
  "DAFT_KEYWORD",
  "DAFT_AVAILABILITY",
  "DAFT_ADDED_IN_LAST_DAYS",
  "DAFT_OPEN_VIEWINGS_FROM",
  "DAFT_SORT",
  "DAFT_MAX_PAGES",
  "BROWSER_MODE",
  "CHROMIUM_EXECUTABLE_PATH",
  "CHROMIUM_HEADLESS",
  "CHROMIUM_NO_SANDBOX",
  "BROWSER_TIMEOUT_MS",
  "BROWSER_USER_AGENT",
  "NTFY_TITLE_PREFIX",
  "NTFY_PRIORITY",
  "NTFY_TAGS",
  "NTFY_TIMEOUT_MS",
  "STATE_FILE",
  "HEARTBEAT_FILE",
  "HEALTHCHECK_MAX_AGE_SECONDS",
  "POLL_INTERVAL_SECONDS",
  "NOTIFY_EXISTING_ON_FIRST_RUN",
  "REDIS_LOCK_KEY",
  "REDIS_LOCK_TTL_SECONDS",
] as const;

const plainRuntimeEnvironment = (): Record<string, string> => {
  const environment: Record<string, string> = {};
  for (const key of RUNTIME_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
};


export default Alchemy.Stack(
  "DaftHouseSearch",
  {
    providers: Layer.merge(Docker.providers(), Alchemy.RandomProvider()),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const remoteDockerHost = process.env.ALCHEMY_DOCKER_HOST?.trim();
    const target = remoteDockerHost
      ? yield* Docker.Context("target-docker", {
          name:
            process.env.ALCHEMY_DOCKER_CONTEXT_NAME ?? "daft-house-search-target",
          docker: remoteDockerHost.startsWith("host=")
            ? remoteDockerHost
            : `host=${remoteDockerHost}`,
        })
      : undefined;
    const image = yield* Docker.Image("monitor-image", {
      name: process.env.MONITOR_IMAGE_NAME ?? "daft-house-search",
      tag: process.env.MONITOR_IMAGE_TAG ?? "latest",
      context: target,
      build: {
        context: ".",
        dockerfile: "Dockerfile",
      },
    });
    const stateVolume = yield* Docker.Volume("state-volume", {
      name: process.env.MONITOR_VOLUME_NAME ?? "daft-house-search-data",
      context: target,
    });

    const environment: Record<string, string | Redacted.Redacted<string>> = {
      ...plainRuntimeEnvironment(),
      NTFY_URL: yield* Config.string("NTFY_URL"),
    };
    const ntfyToken = yield* Config.option(Config.redacted("NTFY_TOKEN"));
    const databaseUrl = yield* Config.option(Config.redacted("DATABASE_URL"));
    const redisUrl = yield* Config.option(Config.redacted("REDIS_URL"));
    const browserEndpoint = yield* Config.option(
      Config.redacted("PLAYWRIGHT_WS_ENDPOINT"),
    );
    if (Option.isSome(ntfyToken)) environment.NTFY_TOKEN = ntfyToken.value;
    if (Option.isSome(databaseUrl)) environment.DATABASE_URL = databaseUrl.value;
    if (Option.isSome(redisUrl)) environment.REDIS_URL = redisUrl.value;
    if (Option.isSome(browserEndpoint)) {
      environment.PLAYWRIGHT_WS_ENDPOINT = browserEndpoint.value;
    }

    const network = process.env.MONITOR_DOCKER_NETWORK?.trim();
    const container = yield* Docker.Container("monitor", {
      name: process.env.MONITOR_CONTAINER_NAME ?? "daft-house-search",
      image,
      context: target,
      environment,
      volumes: [
        {
          hostPath: stateVolume.name,
          containerPath: "/data",
        },
      ],
      networks: network
        ? [{ name: network, aliases: ["daft-house-search"] }]
        : undefined,
      restart: "unless-stopped",
      stopTimeout: "30 seconds",
      healthcheck: {
        cmd: ["CMD", "node", "dist/healthcheck.js"],
        interval: "60 seconds",
        timeout: "10 seconds",
        retries: 3,
        startPeriod: "120 seconds",
      },
      start: true,
    });

    return {
      container: container.name,
      image: image.imageRef,
      stateVolume: stateVolume.name,
      dockerNetwork: network ?? "engine default network",
    };
  }),
);
