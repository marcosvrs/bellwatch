import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import * as Effect from "effect/Effect";
import type { MonitorConfig } from "./config.js";
import { buildDaftSearchUrl } from "./daft/url.js";
import { parseDaftPage, type DaftFinding } from "./daft/parser.js";
import type { Lease } from "./lease.js";
import type { StateStore } from "./state.js";

export class MonitorError extends Error {
  readonly _tag = "MonitorError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MonitorError";
  }
}

export interface MonitorDependencies {
  readonly fetchPage: (url: string) => Effect.Effect<unknown, Error>;
  readonly publish: (finding: DaftFinding) => Effect.Effect<void, Error>;
  readonly state: StateStore;
  readonly lease: Lease;
  readonly heartbeat: () => Effect.Effect<void, Error>;
}

export interface MonitorStats {
  readonly pages: number;
  readonly findings: number;
  readonly notified: number;
  readonly seeded: number;
  readonly skipped: boolean;
}

const collectFindings = (
  config: MonitorConfig,
  dependencies: MonitorDependencies,
): Effect.Effect<{ findings: readonly DaftFinding[]; pages: number }, Error> =>
  Effect.gen(function* () {
    const byId = new Map<string, DaftFinding>();
    let pages = 0;
    for (let page = 1; page <= config.daft.maxPages; page += 1) {
      const url = buildDaftSearchUrl(
        {
          baseUrl: config.daft.baseUrl,
          sectionPath: config.daft.sectionPath,
          filters: config.daft.filters,
        },
        page,
      );
      const payload = yield* dependencies.fetchPage(url);
      const parsed = yield* Effect.try({
        try: () => parseDaftPage(payload, config.daft.baseUrl),
        catch: (cause) => new MonitorError(`Could not parse Daft page ${page}`, { cause }),
      });
      pages += 1;
      for (const finding of parsed.findings) byId.set(finding.id, finding);
      if (parsed.currentPage >= parsed.totalPages) break;
    }
    return { findings: [...byId.values()], pages };
  });

const runWithLease = (
  config: MonitorConfig,
  dependencies: MonitorDependencies,
): Effect.Effect<MonitorStats, Error> =>
  Effect.gen(function* () {
    const collected = yield* collectFindings(config, dependencies);
    const existingState = yield* dependencies.state.hasAny();
    let notified = 0;
    let seeded = 0;

    if (!existingState && !config.polling.notifyExistingOnFirstRun) {
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

    yield* dependencies.heartbeat();
    return {
      pages: collected.pages,
      findings: collected.findings.length,
      notified,
      seeded,
      skipped: false,
    };
  });

export const runOnce = (
  config: MonitorConfig,
  dependencies: MonitorDependencies,
): Effect.Effect<MonitorStats, Error> =>
  Effect.gen(function* () {
    const acquired = yield* dependencies.lease.acquire();
    if (!acquired) {
      return {
        pages: 0,
        findings: 0,
        notified: 0,
        seeded: 0,
        skipped: true,
      } satisfies MonitorStats;
    }
    return yield* runWithLease(config, dependencies).pipe(
      Effect.ensuring(dependencies.lease.release()),
    );
  });

export const writeHeartbeat = (
  file: string,
): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, `${new Date().toISOString()}\n`, "utf8");
    },
    catch: (cause) => new MonitorError(`Could not write heartbeat ${file}`, { cause }),
  });
