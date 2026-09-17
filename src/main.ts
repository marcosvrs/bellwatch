import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { parseEnvironment, ConfigurationError } from "./config.js";
import { fetchDaftPayload } from "./browser.js";
import { createLease } from "./lease.js";
import { runOnce, writeHeartbeat } from "./monitor.js";
import { publishFinding } from "./shoutrrr.js";
import { createStateStore } from "./state.js";

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
  const lease = yield* createLease(config.redis);
  const dependencies = {
    fetchPage: (url: string) => fetchDaftPayload(config, url),
    publish: (finding: Parameters<typeof publishFinding>[1]) =>
      publishFinding(config.shoutrrr, finding),
    state,
    lease,
    heartbeat: () => writeHeartbeat(config.state.heartbeatFile),
  };

  const cycle = Effect.catch(
    Effect.as(
      Effect.tap(runOnce(config, dependencies), (stats) =>
        Effect.logInfo(
          `Daft poll complete: pages=${stats.pages} findings=${stats.findings} notified=${stats.notified} seeded=${stats.seeded} skipped=${stats.skipped}`,
        ),
      ),
      undefined,
    ),
    (error: unknown) =>
      Effect.logError(
        `Daft poll failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
  );

  yield* Effect.ensuring(
    Effect.repeat(cycle, () =>
      Schedule.spaced(`${config.polling.intervalSeconds} seconds`),
    ),
    Effect.all([state.close(), lease.close()], { discard: true }),
  );
});

Effect.runPromise(program).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
