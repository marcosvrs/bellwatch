import { performance } from "node:perf_hooks";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { parseEnvironment, ConfigurationError } from "./config.js";
import { fetchDaftPayload, resolveBrowserUserAgent } from "./browser.js";
import { runOnce, writeHeartbeat } from "./monitor.js";
import { publishFinding, publishMessage } from "./shoutrrr.js";
import { publishHermesFinding, publishHermesMessage } from "./hermes.js";
import { createStateStore } from "./state.js";
import { createMyHomePageFetcher } from "./myhome-fetch.js";
import {
  loadDublinBoundary,
  type DublinBoundaryGeometry,
} from "./dublin-boundary.js";
import { searchSearxng } from "./searxng.js";
import { syncBaserow } from "./baserow.js";
import {
  createRuntimeMetrics,
  type RuntimeMetrics,
} from "./runtime-metrics.js";
import {
  formatPollError,
  publishToAll,
  type NotificationPublisher,
} from "./notifications.js";
import type { DaftFinding } from "./daft/parser.js";
import type { ListingSource } from "./listings.js";

const formatRuntimeMetrics = (
  metrics: RuntimeMetrics,
  durationMs: number,
): string =>
  [
    `duration_ms=${durationMs.toFixed(1)}`,
    `sample_interval_ms=${metrics.intervalMs.toFixed(1)}`,
    `cpu_pct=${metrics.cpuPercent.toFixed(2)}`,
    `cpu_user_ms=${metrics.cpuUserMs.toFixed(1)}`,
    `cpu_system_ms=${metrics.cpuSystemMs.toFixed(1)}`,
    `event_loop_utilization_pct=${(metrics.eventLoopUtilization * 100).toFixed(2)}`,
    `event_loop_active_ms=${metrics.eventLoopActiveMs.toFixed(1)}`,
    `event_loop_idle_ms=${metrics.eventLoopIdleMs.toFixed(1)}`,
    `rss_mb=${metrics.rssMb.toFixed(1)}`,
    `heap_used_mb=${metrics.heapUsedMb.toFixed(1)}`,
    `heap_total_mb=${metrics.heapTotalMb.toFixed(1)}`,
    `external_mb=${metrics.externalMb.toFixed(1)}`,
    `array_buffers_mb=${metrics.arrayBuffersMb.toFixed(1)}`,
    `max_rss_mb=${metrics.maxRssMb.toFixed(1)}`,
    `gc_count=${metrics.gc.total}`,
    `gc_ms=${metrics.gc.durationMs.toFixed(1)}`,
    `gc_major=${metrics.gc.major}`,
    `gc_minor=${metrics.gc.minor}`,
    `gc_incremental=${metrics.gc.incremental}`,
    `gc_weakcb=${metrics.gc.weakCallback}`,
  ].join(" ");

const fetchWithTimeout = (timeoutMs: number): typeof fetch =>
  async (input, init) => {
    const requestInit = init ?? {};
    return globalThis.fetch(input, {
      ...requestInit,
      signal: requestInit.signal ?? AbortSignal.timeout(timeoutMs),
    });
  };

const program = Effect.gen(function* () {
  const config = yield* Effect.try({
    try: () => parseEnvironment(),
    catch: (cause) =>
      cause instanceof ConfigurationError
        ? cause
        : new ConfigurationError("Could not load environment configuration", {
            cause,
          }),
  });
  const state = yield* createStateStore(config.state);
  const sharedFetch = fetchWithTimeout(15_000);
  const myhomePageFetcher = createMyHomePageFetcher({
    baseUrl: config.myhome.baseUrl,
    userAgent: resolveBrowserUserAgent(config.browser),
    minimumDelayMs: config.daft.requestDelayMs,
    timeoutMs: config.browser.timeoutMs,
  });
  let dublinBoundaryPromise: Promise<DublinBoundaryGeometry> | undefined;
  const cachedDublinBoundary = async (): Promise<DublinBoundaryGeometry> => {
    dublinBoundaryPromise ??= loadDublinBoundary(sharedFetch).catch((error: unknown) => {
      dublinBoundaryPromise = undefined;
      throw error;
    });
    return dublinBoundaryPromise;
  };
  const dependencies = {
    fetchPage: (url: string) => fetchDaftPayload(config, url),
    fetchMyHomePage: (url: string) =>
      Effect.tryPromise({
        try: async () => myhomePageFetcher(url),
        catch: (cause) =>
          cause instanceof Error
            ? cause
            : new Error("MyHome request failed", { cause }),
      }),
    loadDublinBoundary: () =>
      Effect.tryPromise({
        try: cachedDublinBoundary,
        catch: (cause) =>
          cause instanceof Error
            ? cause
            : new Error("Dublin boundary request failed", { cause }),
      }),
    searchSearxng: (baseUrl: string) =>
      Effect.tryPromise({
        try: async () =>
          searchSearxng({
            baseUrl,
            sectionPath: config.daft.sectionPath,
            locations: config.daft.locations,
            filters: config.daft.filters,
            fetch: fetchWithTimeout(config.searxng?.timeoutMs ?? 15_000),
          }),
        catch: (cause) =>
          cause instanceof Error
            ? cause
            : new Error("SearXNG request failed", { cause }),
      }),
    publish: (finding: DaftFinding, source: ListingSource) => {
      const publishers: NotificationPublisher[] = [];
      if (config.notificationBackends.includes("shoutrrr")) {
        publishers.push(() =>
          publishFinding(config.shoutrrr, finding, source),
        );
      }
      if (config.notificationBackends.includes("hermes")) {
        const hermes = config.hermes;
        if (hermes === undefined) {
          throw new Error("Hermes backend configuration is missing");
        }
        publishers.push(() =>
          publishHermesFinding(hermes, finding, source),
        );
      }
      return publishToAll(publishers);
    },
    publishError: (error: Error) => {
      const message = formatPollError(error);
      const publishers: NotificationPublisher[] = [];
      if (config.notificationBackends.includes("shoutrrr")) {
        publishers.push(() =>
          publishMessage(config.shoutrrr, "Bellwatch error", message),
        );
      }
      if (config.notificationBackends.includes("hermes")) {
        const hermes = config.hermes;
        if (hermes === undefined) {
          throw new Error("Hermes backend configuration is missing");
        }
        publishers.push(() => publishHermesMessage(hermes, message));
      }
      return publishToAll(publishers);
    },
    state,
    heartbeat: () => writeHeartbeat(config.state.heartbeatFile),
  };

  const metrics = createRuntimeMetrics();
  const cycle = Effect.gen(function* () {
    const cycleStartedAt = yield* Effect.sync(() => performance.now());
    yield* Effect.catch(
      Effect.gen(function* () {
        const stats = yield* runOnce(config, dependencies);
        const runtime = yield* Effect.sync(() => metrics.snapshot());
        yield* Effect.logInfo(
          `Property poll complete: pages=${stats.pages} findings=${stats.findings} notified=${stats.notified} seeded=${stats.seeded} ${formatRuntimeMetrics(runtime, performance.now() - cycleStartedAt)}`,
        );
      }),
      (error: unknown) =>
        Effect.gen(function* () {
          const runtime = yield* Effect.sync(() => metrics.snapshot());
          yield* Effect.logError(
            `Property poll failed: ${error instanceof Error ? error.message : String(error)} ${formatRuntimeMetrics(runtime, performance.now() - cycleStartedAt)}`,
          );
        }),
    );
    if (config.baserow !== undefined) {
      yield* Effect.catch(
        syncBaserow({
          ...config.baserow,
          state,
          fetch: sharedFetch,
        }),
        (error) =>
          Effect.logWarning(
            `Baserow sync failed; local outbox retained: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
      );
    }
  });

  yield* Effect.ensuring(
    Effect.repeat(
      cycle,
      Schedule.cron(config.polling.cron, config.polling.timezone),
    ),
    Effect.all(
      [state.close(), Effect.sync(() => { metrics.close(); })],
      { discard: true },
    ),
  );
});

const waitForShutdownSignal = Effect.callback<void>((resume) => {
  const onSignal = () => { resume(Effect.void); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return Effect.sync(() => {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  });
});

Effect.runPromise(
  Effect.raceFirst(program, waitForShutdownSignal),
).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
