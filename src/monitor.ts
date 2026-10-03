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
import {
  isQualifyingHouse,
  sourcedFindingKey,
  type ListingSource,
  type SourcedFinding,
} from "./listings.js";
import {
  applyMyHomeFilters,
  buildMyHomeUrl,
  enrichMyHomeFinding,
  parseMyHomeDetailPage,
  parseMyHomeListPage,
  parseMyHomeRegionRoutes,
  resolveMyHomeSearchPath,
  validateMyHomeFilterSupport,
  type MyHomeFinding,
} from "./myhome.js";
import {
  classifyDublinBoundary,
  type DublinBoundaryGeometry,
} from "./dublin-boundary.js";
import type { SearxngSearchResult } from "./searxng.js";
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

const collectDaftFindings = (
  config: MonitorConfig,
  dependencies: MonitorDependencies,
): Effect.Effect<{ findings: readonly SourcedFinding[]; pages: number }, Error> =>
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
        for (const finding of parsed.findings) { byId.set(finding.id, finding); }
        if (parsed.currentPage >= parsed.totalPages) { break; }
      }
    }
    const rawFindings = [...byId.values()];
    const shouldHydrate =
      config.shps.filter !== "off" ||
      config.baserow !== undefined ||
      rawFindings.some((finding) => needsComparableDetails(config, finding));
    const candidates = shouldHydrate
      ? yield* hydrateListingFindings(
          rawFindings,
          dependencies,
          config.shps.filter === "off",
        )
      : rawFindings;
    const findings = filterShpsFindings(candidates, config.shps)
      .filter(isQualifyingHouse)
      .map((finding): SourcedFinding => ({
        source: "daft",
        sourceId: finding.id,
        finding,
      }));
    return { findings, pages };
  });

const collectMyHomeFindings = (
  config: MonitorConfig,
  dependencies: MonitorDependencies,
): Effect.Effect<{ findings: readonly SourcedFinding[]; pages: number }, Error> =>
  Effect.gen(function* () {
    const fetchMyHomePage = dependencies.fetchMyHomePage;
    if (!config.myhome.enabled || fetchMyHomePage === undefined) {
      return { findings: [], pages: 0 };
    }
    const support = validateMyHomeFilterSupport(
      config.daft.sectionPath,
      config.daft.filters,
    );
    if (support.unsupportedFilters.length > 0) {
      yield* Effect.logWarning(
        `MyHome skipped; unsupported active Daft filters: ${support.unsupportedFilters.join(", ")}`,
      );
      return { findings: [], pages: 0 };
    }

    let searchPath: string | undefined;
    if (config.daft.locations.length === 0) {
      searchPath = resolveMyHomeSearchPath(
        config.daft.sectionPath,
        [],
        config.daft.filters,
        [],
      ).searchPath;
    } else {
      const nationwide = resolveMyHomeSearchPath(
        config.daft.sectionPath,
        [],
        config.daft.filters,
        [],
      );
      if (nationwide.searchPath === undefined) {
        yield* Effect.logWarning(
          "MyHome skipped; no verified nationwide route for location discovery",
        );
        return { findings: [], pages: 0 };
      }
      const regionHtml = yield* fetchMyHomePage(
        buildMyHomeUrl(config.myhome.baseUrl, nationwide.searchPath),
      );
      const regionRoutes = parseMyHomeRegionRoutes(regionHtml);
      const locationSupport = resolveMyHomeSearchPath(
        config.daft.sectionPath,
        config.daft.locations,
        config.daft.filters,
        regionRoutes,
      );
      if (locationSupport.searchPath === undefined) {
        yield* Effect.logWarning(
          `MyHome skipped; unsupported active Daft location filters: ${
            locationSupport.unsupportedLocationFilters.join(", ") || "unverified route"
          }`,
        );
        return { findings: [], pages: 0 };
      }
      searchPath = locationSupport.searchPath;
    }
    if (searchPath === undefined) {
      yield* Effect.logWarning("MyHome skipped; no verified search route");
      return { findings: [], pages: 0 };
    }
    const byId = new Map<string, MyHomeFinding>();
    let pages = 0;
    for (
      let page = 1;
      config.daft.maxPages === undefined || page <= config.daft.maxPages;
      page += 1
    ) {
      const url = buildMyHomeUrl(config.myhome.baseUrl, searchPath, page);
      const html = yield* fetchMyHomePage(url);
      const parsed = yield* Effect.try({
        try: () => parseMyHomeListPage(html, url),
        catch: (cause) =>
          new MonitorError(`Could not parse MyHome page ${page}`, { cause }),
      });
      pages += 1;
      for (const finding of parsed.findings) { byId.set(finding.sourceId, finding); }
      if (parsed.currentPage >= parsed.totalPages) { break; }
    }

    const enriched: MyHomeFinding[] = [];
    for (const finding of byId.values()) {
      const enrichedFinding = yield* Effect.catch(
        Effect.gen(function* () {
          const html = yield* fetchMyHomePage(finding.finding.url);
          const detail = yield* Effect.try({
            try: () => parseMyHomeDetailPage(html, finding.finding.url),
            catch: (cause) =>
              new MonitorError(`Could not parse MyHome detail ${finding.finding.url}`, {
                cause,
              }),
          });
          return enrichMyHomeFinding(finding, detail);
        }),
        (error) =>
          Effect.gen(function* () {
            yield* Effect.logWarning(
              `Could not hydrate MyHome listing ${finding.sourceId} at ${finding.finding.url}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return undefined;
          }),
      );
      if (enrichedFinding !== undefined) { enriched.push(enrichedFinding); }
    }
    const filtered = applyMyHomeFilters(
      enriched,
      config.daft.sectionPath,
      config.daft.filters,
    );
    if (filtered.unverifiedSourceIds.length > 0) {
      yield* Effect.logWarning(
        `MyHome excluded ${filtered.unverifiedSourceIds.length} listing(s) with unverified active-filter evidence`,
      );
    }
    const shpsIds = new Set(
      filterShpsFindings(
        filtered.findings.map((finding) => finding.finding),
        config.shps,
      ).map((finding) => finding.id),
    );
    const findings = filtered.findings
      .filter((finding) => shpsIds.has(finding.finding.id))
      .filter((finding) => isQualifyingHouse(finding.finding));
    return { findings, pages };
  });

const withDublinClassification = (
  listing: SourcedFinding,
  geometry: DublinBoundaryGeometry | undefined,
): SourcedFinding => {
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
): Effect.Effect<{ findings: readonly SourcedFinding[]; pages: number }, Error> =>
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
    if (config.searxng !== undefined && dependencies.searchSearxng !== undefined) {
      const result = yield* Effect.catch(
        dependencies.searchSearxng(config.searxng.baseUrl),
        (error) =>
          Effect.gen(function* () {
            yield* Effect.logWarning(
              `SearXNG search failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return undefined;
          }),
      );
      if (result !== undefined && !result.ok) {
        yield* Effect.logWarning(
          `SearXNG search ${result.error.code}: ${result.error.message}`,
        );
      }
      if (result?.ok) {
        for (const candidate of result.candidates) {
          yield* dependencies.state.recordCandidate(candidate);
        }
      }
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
    const pending: SourcedFinding[] = [];

    if (!notifyExisting) {
      for (const listing of collected.findings) {
        const key = sourcedFindingKey(listing);
        const current = yield* dependencies.state.getCurrentListing(key);
        yield* dependencies.state.markSeen(
          { ...listing.finding, id: key },
          current?.canonicalGroupKey,
        );
        seeded += 1;
      }
    } else {
      const pendingGroups = new Set<string>();
      for (const listing of collected.findings) {
        const key = sourcedFindingKey(listing);
        const current = yield* dependencies.state.getCurrentListing(key);
        const groupKey = current?.canonicalGroupKey;
        const alreadySeen = yield* dependencies.state.isSeen(key, groupKey);
        if (alreadySeen) {
          yield* dependencies.state.markSeen(
            { ...listing.finding, id: key },
            groupKey,
          );
          continue;
        }
        if (groupKey !== undefined && pendingGroups.has(groupKey)) {
          continue;
        }
        pending.push(listing);
        if (groupKey !== undefined) { pendingGroups.add(groupKey); }
      }

      const daftFindings = pending
        .filter((listing) => listing.source === "daft")
        .map((listing) => listing.finding);
      const enrichedDaft =
        config.daft.sectionPath === "property-for-sale" ||
        config.daft.sectionPath === "new-homes-for-sale"
          ? yield* enrichWithSoldComparables(daftFindings, config, dependencies)
          : daftFindings;
      const enrichedById = new Map(
        enrichedDaft.map((finding) => [finding.id, finding]),
      );
      for (const listing of pending) {
        const key = sourcedFindingKey(listing);
        const finding =
          listing.source === "daft"
            ? enrichedById.get(listing.finding.id) ?? listing.finding
            : listing.finding;
        yield* dependencies.publish(finding, listing.source);
        const current = yield* dependencies.state.getCurrentListing(key);
        yield* dependencies.state.markSeen(
          { ...finding, id: key },
          current?.canonicalGroupKey,
        );
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
