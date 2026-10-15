import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import * as Effect from "effect/Effect";
import type { MonitorConfig } from "./config.js";
import type { DaftFinding } from "./daft/parser.js";
import {
  sourcedListingKey,
  type ListingSource,
  type SourcedListing,
} from "./listings.js";
import {
  classifyDublinBoundary,
  type DublinBoundaryGeometry,
} from "./dublin-boundary.js";
import {
  collectDaftFindings,
  enrichWithSoldComparables,
} from "./monitor/sources/daft.js";
import { collectMyHomeFindings } from "./monitor/sources/myhome.js";
import { MonitorError } from "./monitor/error.js";
export { MonitorError } from "./monitor/error.js";
import type { SearxngSearchResult } from "./searxng.js";
import { collectSearxngCandidates } from "./monitor/sources/searxng.js";
import type { StateStore } from "./state.js";

type PollStateStore = Pick<
  StateStore,
  | "isInitialized"
  | "markInitialized"
  | "isSeen"
  | "markSeen"
  | "observeFinding"
  | "getCurrentListing"
  | "recordCandidate"
>;


const daftFindingFor = (
  listing: Extract<SourcedListing, { readonly source: "daft" }>,
): DaftFinding => ({
  id: listing.sourceId,
  ...listing.facts,
  ...listing.daftEvidence,
});

const findingForNotification = (
  listing: SourcedListing,
  enrichedById: ReadonlyMap<string, DaftFinding>,
): DaftFinding =>
  listing.source === "daft"
    ? (enrichedById.get(listing.sourceId) ?? daftFindingFor(listing))
    : { id: sourcedListingKey(listing), ...listing.facts };

interface MonitorDependencies {
  readonly fetchPage: (url: string) => Effect.Effect<unknown, Error>;
  readonly fetchMyHomePage?: (url: string) => Effect.Effect<string, Error>;
  readonly loadDublinBoundary?: () => Effect.Effect<DublinBoundaryGeometry, Error>;
  readonly searchSearxng?: (baseUrl: string) => Effect.Effect<
    SearxngSearchResult,
    Error
  >;
  readonly publish: (
    finding: DaftFinding,
    source: ListingSource,
  ) => Effect.Effect<void, Error>;
  readonly publishError: (error: Error) => Effect.Effect<void, Error>;
  readonly state: PollStateStore;
  readonly heartbeat: () => Effect.Effect<void, Error>;
}

interface MonitorStats {
  readonly pages: number;
  readonly findings: number;
  readonly notified: number;
  readonly seeded: number;
}



const withDublinClassification = (
  listing: SourcedListing,
  geometry: DublinBoundaryGeometry | undefined,
): SourcedListing => {
  const { latitude, longitude } = listing;
  if (latitude === undefined || longitude === undefined) {
    return {
      ...listing,
      dublinBoundary: { status: "unclassified", reason: "missing-coordinates" },
    };
  }
  if (geometry === undefined) {
    return {
      ...listing,
      dublinBoundary: { status: "unclassified", reason: "boundary-unavailable" },
    };
  }
  return {
    ...listing,
    dublinBoundary: {
      status: "classified",
      ...classifyDublinBoundary({ latitude, longitude }, geometry),
    },
  };
};

const collectFindings = (
  config: MonitorConfig,
  dependencies: MonitorDependencies,
): Effect.Effect<{ findings: readonly SourcedListing[]; pages: number }, Error> =>
  Effect.gen(function* () {
    const daft = yield* collectDaftFindings(config, dependencies);
    const myhome = yield* Effect.catch(
      collectMyHomeFindings(config, dependencies),
      (error) =>
        Effect.gen(function* () {
          yield* Effect.logWarning(
            `MyHome source failed without affecting Daft results: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return { findings: [], pages: 0 };
        }),
    );
    let findings = [...daft.findings, ...myhome.findings];
    const candidates = yield* collectSearxngCandidates(config, dependencies);
    for (const candidate of candidates) {
      yield* dependencies.state.recordCandidate(candidate);
    }

    const hasValidCoordinates = findings.some(
      ({ latitude, longitude }) =>
        latitude !== undefined && longitude !== undefined,
    );
    let geometry: DublinBoundaryGeometry | undefined;
    if (hasValidCoordinates && dependencies.loadDublinBoundary !== undefined) {
      geometry = yield* Effect.catch(
        dependencies.loadDublinBoundary(),
        (error) =>
          Effect.gen(function* () {
            yield* Effect.logWarning(
              `Dublin boundary unavailable; coordinates remain unclassified: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return undefined;
          }),
      );
    }
    findings = findings.map((listing) => withDublinClassification(listing, geometry));
    return { findings, pages: daft.pages + myhome.pages };
  });

const runPoll = (
  config: MonitorConfig,
  dependencies: MonitorDependencies,
): Effect.Effect<MonitorStats, Error> =>
  Effect.gen(function* () {
    const collected = yield* collectFindings(config, dependencies);
    for (const listing of collected.findings) {
      yield* dependencies.state.observeFinding(listing);
    }
    const initialized = yield* dependencies.state.isInitialized();
    const notifyExisting =
      initialized || config.polling.notifyExistingOnFirstRun;
    let notified = 0;
    let seeded = 0;
    const pending: SourcedListing[] = [];

    if (!notifyExisting) {
      for (const listing of collected.findings) {
        const key = sourcedListingKey(listing);
        const current = yield* dependencies.state.getCurrentListing(key);
        yield* dependencies.state.markSeen(key, current?.canonicalGroupKey);
        seeded += 1;
      }
    } else {
      const pendingGroups = new Set<string>();
      for (const listing of collected.findings) {
        const key = sourcedListingKey(listing);
        const current = yield* dependencies.state.getCurrentListing(key);
        const groupKey = current?.canonicalGroupKey;
        const alreadySeen = yield* dependencies.state.isSeen(key, groupKey);
        if (alreadySeen) {
          yield* dependencies.state.markSeen(key, groupKey);
          continue;
        }
        const pendingKey = groupKey ?? key;
        if (pendingGroups.has(pendingKey)) {
          continue;
        }
        pending.push(listing);
        pendingGroups.add(pendingKey);
      }

      const daftFindings = pending
        .filter(
          (listing): listing is Extract<SourcedListing, { source: "daft" }> =>
            listing.source === "daft",
        )
        .map(daftFindingFor);
      const enrichedDaft =
        config.daft.sectionPath === "property-for-sale" ||
        config.daft.sectionPath === "new-homes-for-sale"
          ? yield* enrichWithSoldComparables(daftFindings, config, dependencies)
          : daftFindings;
      const enrichedById = new Map(
        enrichedDaft.map((finding) => [finding.id, finding]),
      );
      for (const listing of pending) {
        const key = sourcedListingKey(listing);
        const finding = findingForNotification(listing, enrichedById);
        yield* dependencies.publish(finding, listing.source);
        const current = yield* dependencies.state.getCurrentListing(key);
        yield* dependencies.state.markSeen(key, current?.canonicalGroupKey);
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
): Effect.Effect<void> =>
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
