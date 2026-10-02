import * as Effect from "effect/Effect";
import { classifyHelpToBuyEvidence } from "./daft/shps.js";
import {
  sourcedFindingKey,
  type DiscoveryCandidate,
} from "./listings.js";
import type {
  PendingBaserowCandidate,
  PendingBaserowListing,
  RegistrationEvent,
  StateError,
  StateStore,
} from "./state.js";

export class BaserowSyncError extends Error {
  readonly _tag = "BaserowSyncError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BaserowSyncError";
  }
}

export interface BaserowSyncOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly tableId: string;
  readonly candidateTableId?: string;
  readonly state: StateStore;
  readonly fetch: typeof globalThis.fetch;
}

const tableUrl = (baseUrl: string, tableId: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/api/database/rows/table/${encodeURIComponent(tableId)}/`;


const rowIdFrom = (value: unknown): string | undefined => {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("id" in value)
  ) {
    return undefined;
  }
  const id = value.id;
  if (typeof id === "string" && id.length > 0) {
    return id;
  }
  if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) {
    return String(id);
  }
  return undefined;
};

const requestJson = (
  options: BaserowSyncOptions,
  url: string,
  method: "GET" | "POST" | "PATCH",
  body?: Record<string, unknown>,
): Effect.Effect<unknown, BaserowSyncError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: async () =>
        options.fetch(url, {
          method,
          headers: {
            Authorization: `Token ${options.token}`,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      catch: (cause) =>
        new BaserowSyncError(`Baserow ${method} request failed`, { cause }),
    });
    if (!response.ok) {
      return yield* Effect.fail(
        new BaserowSyncError(
          `Baserow ${method} request failed with HTTP ${response.status}`,
        ),
      );
    }
    if (response.status === 204) {
      return undefined;
    }
    return yield* Effect.tryPromise({
      try: async () => {
        const responseText = await response.text();
        return JSON.parse(responseText) as unknown;
      },
      catch: (cause) => new BaserowSyncError("Baserow returned invalid JSON", { cause }),
    });
  });

const findRowId = (
  options: BaserowSyncOptions,
  endpoint: string,
  identityField: "bellwatch_key" | "candidate_key",
  identityValue: string,
): Effect.Effect<string | undefined, BaserowSyncError> =>
  Effect.gen(function* () {
    const url = new URL(endpoint);
    url.searchParams.set("user_field_names", "true");
    url.searchParams.set(`filter__${identityField}__equal`, identityValue);
    const payload = yield* requestJson(options, url.toString(), "GET");
    let rows: unknown[] | undefined;
    if (Array.isArray(payload)) {
      rows = payload;
    } else if (
      payload !== null &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      "results" in payload &&
      Array.isArray(payload.results)
    ) {
      rows = payload.results;
    }
    if (rows === undefined) {
      return yield* Effect.fail(
        new BaserowSyncError("Baserow returned an invalid row search response"),
      );
    }
    const row = rows.find((candidate) => {
      if (
        candidate === null ||
        typeof candidate !== "object" ||
        Array.isArray(candidate) ||
        !(identityField in candidate)
      ) {
        return false;
      }
      return Reflect.get(candidate, identityField) === identityValue;
    });
    if (row === undefined) {
      return undefined;
    }
    const id = rowIdFrom(row);
    if (id === undefined) {
      return yield* Effect.fail(
        new BaserowSyncError("Baserow returned a matching row without an ID"),
      );
    }
    return id;
  });

const upsertRow = (
  options: BaserowSyncOptions,
  endpoint: string,
  identityField: "bellwatch_key" | "candidate_key",
  identityValue: string,
  fields: Record<string, unknown>,
  persistedRowId: string | null,
): Effect.Effect<string, BaserowSyncError> =>
  Effect.gen(function* () {
    const existingRowId =
      persistedRowId ??
      (yield* findRowId(options, endpoint, identityField, identityValue));
    if (existingRowId !== undefined) {
      yield* requestJson(
        options,
        `${endpoint}${encodeURIComponent(existingRowId)}/?user_field_names=true`,
        "PATCH",
        fields,
      );
      return existingRowId;
    }

    const createUrl = `${endpoint}?user_field_names=true`;
    const created = yield* requestJson(options, createUrl, "POST", fields);
    const rowId = rowIdFrom(created);
    if (rowId === undefined) {
      return yield* Effect.fail(
        new BaserowSyncError("Baserow created a row without returning its ID"),
      );
    }
    return rowId;
  });

const listingFields = (
  listing: PendingBaserowListing,
  registrationHistory: readonly RegistrationEvent[],
): Record<string, unknown> => {
  const finding = listing.finding;
  const dublinBoundary = listing.dublinBoundary ?? {
    status: "unclassified" as const,
    reason:
      listing.latitude === undefined || listing.longitude === undefined
        ? "missing-coordinates" as const
        : "boundary-unavailable" as const,
  };
  const classified = dublinBoundary.status === "classified";
  const latestRegistration = registrationHistory.at(-1);
  return {
    bellwatch_key: sourcedFindingKey(listing),
    source: listing.source,
    source_id: listing.sourceId,
    title: finding.title,
    development_title: finding.developmentTitle,
    price_text: finding.priceText,
    bedrooms: finding.bedrooms ?? null,
    bathrooms: finding.bathrooms ?? null,
    property_type: finding.propertyType ?? null,
    floor_size_sqm: finding.floorSizeSqm ?? null,
    ber_rating: finding.berRating ?? null,
    help_to_buy_evidence_status: classifyHelpToBuyEvidence(finding),
    registration_status: latestRegistration?.status ?? null,
    registration_consent_status: latestRegistration?.consentStatus ?? null,
    registration_evidence: latestRegistration?.evidence ?? null,
    registration_updated_at: latestRegistration?.recordedAt ?? null,
    registration_history_json: JSON.stringify(registrationHistory),
    address: finding.address ?? null,
    eircode: finding.eircode ?? null,
    latitude: listing.latitude ?? null,
    longitude: listing.longitude ?? null,
    dublin_status: dublinBoundary.status,
    dublin_in_county: classified ? dublinBoundary.insideCounty : null,
    dublin_boundary_distance_km: classified
      ? dublinBoundary.nearestBoundaryDistanceKm
      : null,
    dublin_within_20km: classified ? dublinBoundary.withinDublin20Km : null,
    dublin_unclassified_reason: classified ? null : dublinBoundary.reason,
    source_url: finding.url,
    first_seen_at: listing.firstSeenAt,
    last_seen_at: listing.lastSeenAt,
  };
};

const candidateFields = (
  row: PendingBaserowCandidate,
): Record<string, unknown> => {
  const candidate: DiscoveryCandidate = row.candidate;
  return {
    candidate_key: row.candidateKey,
    source: candidate.source,
    verified: candidate.verified,
    title: candidate.title,
    url: candidate.url,
    snippet: candidate.snippet,
    engine: candidate.engine ?? null,
    discovered_at: candidate.discoveredAt,
    first_seen_at: row.firstSeenAt,
    last_seen_at: row.lastSeenAt,
  };
};

export const syncBaserow = (
  options: BaserowSyncOptions,
): Effect.Effect<void, BaserowSyncError | StateError> =>
  Effect.gen(function* () {
    const listings = yield* options.state.listPendingBaserowListings();
    const candidates = yield* options.state.listPendingBaserowCandidates();

    const listingEndpoint = tableUrl(options.baseUrl, options.tableId);
    for (const listing of listings) {
      const key = sourcedFindingKey(listing);
      const registrationHistory = yield* options.state.listRegistrationEvents(key);
      const rowId = yield* upsertRow(
        options,
        listingEndpoint,
        "bellwatch_key",
        key,
        listingFields(listing, registrationHistory),
        listing.rowId,
      );
      yield* options.state.markBaserowListingSynced(
        key,
        rowId,
        listing.revision,
      );
    }
    if (candidates.length > 0 && options.candidateTableId === undefined) {
      return yield* Effect.fail(
        new BaserowSyncError(
          "Pending discovery candidates require a separate candidateTableId",
        ),
      );
    }
    if (candidates.length > 0 && options.candidateTableId === options.tableId) {
      return yield* Effect.fail(
        new BaserowSyncError(
          "Discovery candidates must use a separate Baserow table",
        ),
      );
    }

    if (options.candidateTableId !== undefined) {
      const candidateEndpoint = tableUrl(
        options.baseUrl,
        options.candidateTableId,
      );
      for (const candidate of candidates) {
        const rowId = yield* upsertRow(
          options,
          candidateEndpoint,
          "candidate_key",
          candidate.candidateKey,
          candidateFields(candidate),
          candidate.rowId,
        );
        yield* options.state.markBaserowCandidateSynced(
          candidate.candidateKey,
          rowId,
          candidate.revision,
        );
      }
    }
  });
