import * as Effect from "effect/Effect";
import type { MonitorConfig } from "../../config.js";
import type { SearxngSearchResult } from "../../searxng.js";
import type { DiscoveryCandidate } from "../../listings.js";

interface SearxngCollectionDependencies {
  readonly searchSearxng?: (
    baseUrl: string,
  ) => Effect.Effect<SearxngSearchResult, Error>;
}

export const collectSearxngCandidates = (
  config: MonitorConfig,
  dependencies: SearxngCollectionDependencies,
): Effect.Effect<readonly DiscoveryCandidate[]> =>
  Effect.gen(function* () {
    if (config.searxng === undefined || dependencies.searchSearxng === undefined) {
      return [];
    }
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
    return result?.ok ? result.candidates : [];
  });
