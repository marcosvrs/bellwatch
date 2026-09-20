import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import * as Effect from "effect/Effect";
import type { MonitorConfig } from "./config.js";
import { buildDaftSearchUrl } from "./daft/url.js";
import {
  parseDaftListingDetails,
  parseDaftPage,
  type DaftFinding,
} from "./daft/parser.js";
import { filterShpsFindings } from "./daft/shps.js";
import {
  buildDaftSoldSearchUrl,
  hasDaftSoldMatchFields,
  parseDaftSoldPage,
  summarizeDaftSoldPrices,
  type DaftSoldComparable,
  type DaftSoldComparison,
} from "./daft/sold.js";
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

const hydrateListingFindings = (
  findings: readonly DaftFinding[],
  dependencies: MonitorDependencies,
  bestEffort: boolean,
): Effect.Effect<readonly DaftFinding[], Error> =>
  Effect.gen(function* () {
    const hydrated: DaftFinding[] = [];
    for (const finding of findings) {
      const hydratedFinding = yield* Effect.catch(
        Effect.gen(function* () {
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
          return {
            ...finding,
            ...(details.schemeText === undefined
              ? {}
              : { schemeText: details.schemeText }),
            ...(details.floorSizeSqm === undefined
              ? {}
              : { floorSizeSqm: details.floorSizeSqm }),
            ...(details.berRating === undefined
              ? {}
              : { berRating: details.berRating }),
            ...(details.address === undefined
              ? {}
              : { address: details.address }),
            ...(details.eircode === undefined
              ? {}
              : { eircode: details.eircode }),
          };
        }),
        (error) =>
          bestEffort
            ? Effect.gen(function* () {
                yield* Effect.logWarning(
                  `Could not hydrate Daft listing ${finding.id}: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                );
                return finding;
              })
            : Effect.fail(error),
      );
      hydrated.push(hydratedFinding);
    }
    return hydrated;
  });

const needsComparableDetails = (
  config: MonitorConfig,
  finding: DaftFinding,
): boolean => {
  if (finding.bedrooms === undefined || finding.bathrooms === undefined) {
    return false;
  }
  if (config.daft.sectionPath === "new-homes-for-sale") {
    return (
      !hasDaftSoldMatchFields(finding) ||
      (config.daft.locations.length === 0 &&
        finding.address === undefined &&
        finding.eircode === undefined)
    );
  }
  return (
    config.daft.sectionPath === "property-for-sale" &&
    config.daft.locations.length === 0 &&
    finding.address === undefined &&
    finding.eircode === undefined
  );
};

type DaftSoldSearchRequest = Parameters<typeof buildDaftSoldSearchUrl>[0];
type SoldSearchRequest = {
  readonly request: DaftSoldSearchRequest;
  readonly url: string;
};

const fetchSoldComparables = (
  searchRequest: SoldSearchRequest,
  dependencies: MonitorDependencies,
): Effect.Effect<readonly DaftSoldComparable[], Error> =>
  Effect.gen(function* () {
    const comparables: DaftSoldComparable[] = [];
    for (let page = 1; ; page += 1) {
      const pageUrl = new URL(searchRequest.url);
      if (page > 1) {pageUrl.searchParams.set("page", String(page));}
      const url = pageUrl.toString();
      const request = searchRequest.request;
      const payload = yield* Effect.mapError(
        dependencies.fetchPage(url),
        (cause) =>
          new MonitorError(
            `Could not fetch sold comparables for ${request.finding.propertyType}`,
            { cause },
          ),
      );
      const parsed = yield* Effect.try({
        try: () => parseDaftSoldPage(payload),
        catch: (cause) =>
          new MonitorError(`Could not parse sold comparables ${url}`, {
            cause,
          }),
      });
      comparables.push(...parsed.comparables);
      if (parsed.currentPage >= parsed.totalPages) {break;}
    }
    return comparables;
  });

const fetchSoldComparison = (
  requests: readonly SoldSearchRequest[],
  year: number,
  priceText: string | undefined,
  dependencies: MonitorDependencies,
): Effect.Effect<DaftSoldComparison, Error> =>
  Effect.gen(function* () {
    const prices: number[] = [];
    const seenListingIds = new Set<string>();
    for (const searchRequest of requests) {
      for (const comparable of yield* fetchSoldComparables(
        searchRequest,
        dependencies,
      )) {
        if (comparable.id === undefined) {
          prices.push(comparable.price);
          continue;
        }
        if (seenListingIds.has(comparable.id)) {continue;}
        seenListingIds.add(comparable.id);
        prices.push(comparable.price);
      }
    }
    return summarizeDaftSoldPrices(prices, year, priceText);
  });


const enrichWithSoldComparables = (
  findings: readonly DaftFinding[],
  config: MonitorConfig,
  dependencies: MonitorDependencies,
): Effect.Effect<readonly DaftFinding[]> =>
  Effect.gen(function* () {
    const year = new Date().getFullYear();
    const cached = new Map<string, DaftSoldComparison | undefined>();
    const enriched: DaftFinding[] = [];
    for (const finding of findings) {
      if (!hasDaftSoldMatchFields(finding)) {
        enriched.push(finding);
        continue;
      }
      const request = {
        baseUrl: config.daft.baseUrl,
        locations: config.daft.locations,
        finding,
        year,
      };
      const requests =
        config.daft.locations.length === 0
          ? [request]
          : config.daft.locations.map((location) => ({
              ...request,
              locations: [location],
            }));
      const comparableRequests = requests.flatMap((locationRequest) => {
        const url = buildDaftSoldSearchUrl(locationRequest);
        return url === undefined ? [] : [{ request: locationRequest, url }];
      });
      if (comparableRequests.length === 0) {
        enriched.push(finding);
        continue;
      }
      const comparableUrls = comparableRequests.map(({ url }) => url);
      const cacheKey = `${JSON.stringify(comparableUrls)}\u0000${finding.priceText}`;
      let comparison = cached.get(cacheKey);
      if (!cached.has(cacheKey)) {
        comparison = yield* Effect.catch(
          fetchSoldComparison(
            comparableRequests,
            year,
            finding.priceText,
            dependencies,
          ),
          (error) =>
            Effect.gen(function* () {
              yield* Effect.logWarning(
                `Could not load sold comparables for ${finding.id}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              return undefined;
            }),
        );
        cached.set(cacheKey, comparison);
      }
      enriched.push(
        comparison === undefined
          ? finding
          : { ...finding, soldComparison: comparison },
      );
    }
    return enriched;
  });

const collectFindings = (
  config: MonitorConfig,
  dependencies: MonitorDependencies,
): Effect.Effect<{ findings: readonly DaftFinding[]; pages: number }, Error> =>
  Effect.gen(function* () {
    const byId = new Map<string, DaftFinding>();
    let pages = 0;
    const locations: readonly (string | undefined)[] =
      config.daft.locations.length === 0
        ? [undefined]
        : config.daft.locations;
    for (const location of locations) {
      for (
        let page = 1;
        config.daft.maxPages === undefined || page <= config.daft.maxPages;
        page += 1
      ) {
        const url = buildDaftSearchUrl(
          {
            baseUrl: config.daft.baseUrl,
            sectionPath: config.daft.sectionPath,
            locations: location === undefined ? [] : [location],
            filters: config.daft.filters,
          },
          page,
        );
        const payload = yield* dependencies.fetchPage(url);
        const parsed = yield* Effect.try({
          try: () =>
            parseDaftPage(
              payload,
              config.daft.baseUrl,
              config.daft.sectionPath,
            ),
          catch: (cause) =>
            new MonitorError(
              `Could not parse Daft page ${page} for ${location ?? "Ireland"}`,
              { cause },
            ),
        });
        pages += 1;
        for (const finding of parsed.findings) {byId.set(finding.id, finding);}
        if (parsed.currentPage >= parsed.totalPages) {break;}
      }
    }
    const rawFindings = [...byId.values()];
    const shouldHydrate =
      config.shps.filter !== "off" ||
      rawFindings.some((finding) => needsComparableDetails(config, finding));
    const candidates = shouldHydrate
      ? yield* hydrateListingFindings(
          rawFindings,
          dependencies,
          config.shps.filter === "off",
        )
      : rawFindings;
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
    const notifyExisting =
      initialized || config.polling.notifyExistingOnFirstRun;
    let notified = 0;
    let seeded = 0;
    const pending: DaftFinding[] = [];

    if (!notifyExisting) {
      for (const finding of collected.findings) {
        yield* dependencies.state.markSeen(finding);
        seeded += 1;
      }
    } else {
      for (const finding of collected.findings) {
        if (yield* dependencies.state.isSeen(finding.id)) {continue;}
        pending.push(finding);
      }
      const publishable =
        config.daft.sectionPath === "property-for-sale" ||
        config.daft.sectionPath === "new-homes-for-sale"
          ? yield* enrichWithSoldComparables(pending, config, dependencies)
          : pending;
      for (const finding of publishable) {
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
