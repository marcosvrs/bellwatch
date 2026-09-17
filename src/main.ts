import { performance } from "node:perf_hooks";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { parseEnvironment, ConfigurationError } from "./config.js";
import { fetchDaftPayload } from "./browser.js";
import { runOnce, writeHeartbeat } from "./monitor.js";
import { publishFinding } from "./shoutrrr.js";
import { publishHermesFinding } from "./hermes.js";
import { createStateStore } from "./state.js";
import {
  createRuntimeMetrics,
  type RuntimeMetrics,
} from "./runtime-metrics.js";

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
  const dependencies = {
    fetchPage: (url: string) => fetchDaftPayload(config, url),
    publish: (finding: Parameters<typeof publishFinding>[1]) =>
      config.notificationBackend === "hermes"
        ? config.hermes
          ? publishHermesFinding(config.hermes, finding)
          : Effect.fail(
              new ConfigurationError("Hermes notification configuration is missing"),
            )
        : publishFinding(config.shoutrrr, finding),
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
          `Daft poll complete: pages=${stats.pages} findings=${stats.findings} notified=${stats.notified} seeded=${stats.seeded} ${formatRuntimeMetrics(runtime, performance.now() - cycleStartedAt)}`,
        );
      }),
      (error: unknown) =>
        Effect.gen(function* () {
          const runtime = yield* Effect.sync(() => metrics.snapshot());
          yield* Effect.logError(
            `Daft poll failed: ${error instanceof Error ? error.message : String(error)} ${formatRuntimeMetrics(runtime, performance.now() - cycleStartedAt)}`,
          );
        }),
    );
  });

  yield* Effect.ensuring(
    Effect.repeat(
      cycle,
      Schedule.cron(config.polling.cron, config.polling.timezone),
    ),
    Effect.all(
      [state.close(), Effect.sync(() => metrics.close())],
      { discard: true },
    ),
  );
});

const waitForShutdownSignal = Effect.callback<void>((resume) => {
  const onSignal = () => resume(Effect.void);
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
