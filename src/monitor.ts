import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import * as Effect from "effect/Effect";
import type { MonitorConfig } from "./config.js";
import { buildDaftSearchUrl } from "./daft/url.js";
import { matchesDaftPropertyType } from "./daft/filters.js";
import {
  parseDaftListingDetails,
  parseDaftPage,
  type DaftFinding,
} from "./daft/parser.js";
import { filterShpsFindings } from "./daft/shps.js";
import type { StateStore } from "./state.js";

export class MonitorError extends Error {
  readonly _tag = "MonitorError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MonitorError";
  }
}

interface MonitorDependencies {
  readonly fetchPage: (url: string) => Effect.Effect<unknown, Error>;
  readonly publish: (finding: DaftFinding) => Effect.Effect<void, Error>;
  readonly publishError: (error: Error) => Effect.Effect<void, Error>;
  readonly state: StateStore;
  readonly heartbeat: () => Effect.Effect<void, Error>;
}

interface MonitorStats {
  readonly pages: number;
  readonly findings: number;
  readonly notified: number;
  readonly seeded: number;
}

const hydrateShpsFindings = (
  findings: readonly DaftFinding[],
  dependencies: MonitorDependencies,
): Effect.Effect<readonly DaftFinding[], Error> =>
  Effect.gen(function* () {
    const hydrated: DaftFinding[] = [];
    for (const finding of findings) {
      const payload = yield* Effect.mapError(
        dependencies.fetchPage(finding.url),
        (cause) =>
          new MonitorError(`Could not fetch Daft listing ${finding.url}`, {
            cause,
          }),
      );
      const details = yield* Effect.try({
        try: () => parseDaftListingDetails(payload),
        catch: (cause) =>
          new MonitorError(`Could not parse Daft listing ${finding.url}`, {
            cause,
          }),
      });
      if (details.schemeText === undefined) {
        hydrated.push(finding);
        continue;
      }
      hydrated.push({ ...finding, schemeText: details.schemeText });
    }
    return hydrated;
  });

const collectFindings = (
  config: MonitorConfig,
  dependencies: MonitorDependencies,
): Effect.Effect<{ findings: readonly DaftFinding[]; pages: number }, Error> =>
  Effect.gen(function* () {
    const byId = new Map<string, DaftFinding>();
    let pages = 0;
    for (
      let page = 1;
      config.daft.maxPages === undefined || page <= config.daft.maxPages;
      page += 1
    ) {
      const url = buildDaftSearchUrl(
        {
          baseUrl: config.daft.baseUrl,
          sectionPath: config.daft.sectionPath,
          locations: config.daft.locations,
          filters: config.daft.filters,
        },
        page,
      );
      const payload = yield* dependencies.fetchPage(url);
      const parsed = yield* Effect.try({
        try: () => parseDaftPage(payload, config.daft.baseUrl),
        catch: (cause) =>
          new MonitorError(`Could not parse Daft page ${page}`, { cause }),
      });
      pages += 1;
      for (const finding of parsed.findings) {
        if (
          !matchesDaftPropertyType(
            finding.propertyType,
            config.daft.filters.propertyTypes,
          )
        ) {
          continue;
        }
        byId.set(finding.id, finding);
      }
      if (parsed.currentPage >= parsed.totalPages) break;
    }
    const candidates =
      config.shps.filter !== "off"
        ? yield* hydrateShpsFindings([...byId.values()], dependencies)
        : [...byId.values()];
    const findings = filterShpsFindings(candidates, config.shps);
    return { findings, pages };
  });

const runPoll = (
  config: MonitorConfig,
  dependencies: MonitorDependencies,
): Effect.Effect<MonitorStats, Error> =>
  Effect.gen(function* () {
    const collected = yield* collectFindings(config, dependencies);
    const initialized = yield* dependencies.state.isInitialized();
    let notified = 0;
    let seeded = 0;

    if (!initialized && !config.polling.notifyExistingOnFirstRun) {
      for (const finding of collected.findings) {
        yield* dependencies.state.markSeen(finding);
        seeded += 1;
      }
    } else {
      for (const finding of collected.findings) {
        if (yield* dependencies.state.isSeen(finding.id)) continue;
        yield* dependencies.publish(finding);
        yield* dependencies.state.markSeen(finding);
        notified += 1;
      }
    }

    yield* dependencies.state.markInitialized();
    yield* dependencies.heartbeat();
    return {
      pages: collected.pages,
      findings: collected.findings.length,
      notified,
      seeded,
    };
  });
const notifyPollError = (
  dependencies: MonitorDependencies,
  error: Error,
): Effect.Effect<void, never> =>
  Effect.catch(
    dependencies.publishError(error),
    (notificationError) =>
      Effect.logError(
        `Could not publish poll error notification: ${
          notificationError instanceof Error
            ? notificationError.message
            : String(notificationError)
        }`,
      ),
  );

export const runOnce = (
  config: MonitorConfig,
  dependencies: MonitorDependencies,
): Effect.Effect<MonitorStats, Error> =>
  Effect.catch(
    runPoll(config, dependencies),
    (error) =>
      Effect.gen(function* () {
        const failure =
          error instanceof Error ? error : new Error(String(error));
        yield* notifyPollError(dependencies, failure);
        return yield* Effect.fail(failure);
      }),
  );

export const writeHeartbeat = (
  file: string,
): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, `${new Date().toISOString()}\n`);
    },
    catch: (cause) => new MonitorError(`Could not write heartbeat ${file}`, { cause }),
  });
