import * as Effect from "effect/Effect";
import type { MonitorConfig } from "../../config.js";
import { buildDaftSearchUrl } from "../../daft/url.js";
import {
  parseDaftListingDetails,
  parseDaftPage,
  type DaftFinding,
} from "../../daft/parser.js";
import { filterShpsFindings } from "../../daft/shps.js";
import {
  buildDaftSoldSearchUrl,
  hasDaftSoldMatchFields,
  parseDaftSoldPage,
  summarizeDaftSoldPrices,
  type DaftSoldComparable,
  type DaftSoldComparison,
} from "../../daft/sold.js";
import type { SourcedListing } from "../../listings.js";
import { MonitorError } from "../error.js";

type DaftCollectionDependencies = {
  readonly fetchPage: (url: string) => Effect.Effect<unknown, Error>;
};
const hydrateListingFindings = (
  findings: readonly DaftFinding[],
  dependencies: DaftCollectionDependencies,
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
  dependencies: DaftCollectionDependencies,
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
  dependencies: DaftCollectionDependencies,
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


export const enrichWithSoldComparables = (
  findings: readonly DaftFinding[],
  config: MonitorConfig,
  dependencies: DaftCollectionDependencies,
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

export const collectDaftFindings = (
  config: MonitorConfig,
  dependencies: DaftCollectionDependencies,
): Effect.Effect<{ findings: readonly SourcedListing[]; pages: number }, Error> =>
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
      .map((finding): SourcedListing => {
        const { id, soldComparison, individualUnit, ...facts } = finding;
        return {
          source: "daft",
          sourceId: id,
          facts,
          ...(soldComparison === undefined && individualUnit === undefined
            ? {}
            : {
                daftEvidence: {
                  ...(soldComparison === undefined ? {} : { soldComparison }),
                  ...(individualUnit === undefined ? {} : { individualUnit }),
                },
              }),
        };
      });
    return { findings, pages };
  });
