import * as Effect from "effect/Effect";
import type { MonitorConfig } from "../../config.js";
import { filterShpsFindings } from "../../daft/shps.js";
import {
  buildMyHomeSearchUrl,
  buildMyHomeUrl,
  enrichMyHomeFinding,
  getMyHomeNationalSearchPath,
  parseMyHomeDetailPage,
  parseMyHomeListPage,
  parseMyHomeRegionRoutes,
  resolveMyHomeSearchPath,
  validateMyHomeFilterSupport,
  type MyHomeFinding,
} from "../../myhome.js";
import { isMyHomeRobotsDisallowError } from "../../myhome-fetch.js";

type MyHomeCollectionDependencies = {
  readonly fetchMyHomePage?: (url: string) => Effect.Effect<string, Error>;
};
const hasMyHomeQueryFilters = (url: string): boolean => {
  for (const key of new URL(url).searchParams.keys()) {
    if (key !== "page") { return true; }
  }
  return false;
};

export const collectMyHomeFindings = (
  config: MonitorConfig,
  dependencies: MyHomeCollectionDependencies,
): Effect.Effect<{ findings: readonly MyHomeFinding[]; pages: number }, Error> =>
  Effect.gen(function* () {
    const fetchMyHomePage = dependencies.fetchMyHomePage;
    if (!config.myhome.enabled || fetchMyHomePage === undefined) {
      return { findings: [], pages: 0 };
    }
    const sort = config.daft.filters.sort;
    if (
      config.daft.maxPages !== undefined &&
      sort !== undefined &&
      sort !== "bestMatch"
    ) {
      yield* Effect.logWarning(
        `MyHome skipped; cannot preserve ${sort} with DAFT_MAX_PAGES`,
      );
      return { findings: [], pages: 0 };
    }
    const support = validateMyHomeFilterSupport(
      config.daft.sectionPath,
      config.daft.filters,
    );
    if (support.unsupportedFilters.length > 0) {
      yield* Effect.logWarning(
        `MyHome ignoring filters without native equivalents: ${support.unsupportedFilters.join(", ")}`,
      );
    }

    let searchPath: string;
    if (config.daft.locations.length === 0) {
      searchPath = getMyHomeNationalSearchPath(
        config.daft.sectionPath,
        config.daft.filters.availability,
      );
    } else {
      const regionHtml = yield* fetchMyHomePage(
        buildMyHomeUrl(
          config.myhome.baseUrl,
          getMyHomeNationalSearchPath(
            config.daft.sectionPath,
            config.daft.filters.availability,
          ),
        ),
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
            JSON.stringify(locationSupport.unsupportedLocationFilters)
          }`,
        );
        return { findings: [], pages: 0 };
      }
      searchPath = locationSupport.searchPath;
      if (locationSupport.unsupportedLocationFilters.length > 0) {
        yield* Effect.logWarning(
          `MyHome ignoring unsupported location filters: ${
            JSON.stringify(locationSupport.unsupportedLocationFilters)
          }`,
        );
      }
    }
    const byId = new Map<string, MyHomeFinding>();
    let pages = 0;
    for (
      let page = 1;
      config.daft.maxPages === undefined || page <= config.daft.maxPages;
      page += 1
    ) {
      const pageUrl = buildMyHomeSearchUrl(
        config.myhome.baseUrl,
        searchPath,
        config.daft.sectionPath,
        config.daft.filters,
        page,
      );
      const fetched = yield* Effect.match(fetchMyHomePage(pageUrl), {
        onFailure: (error) => ({ _tag: "failure" as const, error }),
        onSuccess: (html) => ({ _tag: "success" as const, html }),
      });
      if (fetched._tag === "failure") {
        if (
          hasMyHomeQueryFilters(pageUrl) &&
          isMyHomeRobotsDisallowError(fetched.error)
        ) {
          yield* Effect.logWarning(
            "MyHome skipped; robots.txt blocks native query filters",
          );
          return { findings: [], pages };
        }
        return yield* Effect.fail(fetched.error);
      }
      const parsed = yield* Effect.try(() =>
        parseMyHomeListPage(fetched.html, pageUrl),
      );
      pages += 1;
      for (const finding of parsed.findings) { byId.set(finding.sourceId, finding); }
      if (parsed.currentPage >= parsed.totalPages) { break; }
    }

    const enriched: MyHomeFinding[] = [];
    for (const finding of byId.values()) {
      const enrichedFinding = yield* Effect.catch(
        Effect.gen(function* () {
          const html = yield* fetchMyHomePage(finding.facts.url);
          const detail = yield* Effect.try(() =>
            parseMyHomeDetailPage(html, finding.facts.url),
          );
          return enrichMyHomeFinding(finding, detail);
        }),
        (error) =>
          Effect.gen(function* () {
            yield* Effect.logWarning(
              `Could not hydrate MyHome listing ${finding.sourceId} at ${finding.facts.url}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return undefined;
          }),
      );
      if (enrichedFinding !== undefined) { enriched.push(enrichedFinding); }
    }
    const shpsFacts = new Set(
      filterShpsFindings(
        enriched.map((finding) => finding.facts),
        config.shps,
      ),
    );
    const findings = enriched.filter((finding) => shpsFacts.has(finding.facts));
    return { findings, pages };
  });
