import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import * as Effect from "effect/Effect";
import postgres from "postgres";
import type { DaftFinding } from "./daft/parser.js";
import {
  sourcedFindingKey,
  type DiscoveryCandidate,
  type SourcedFinding,
} from "./listings.js";

export class StateError extends Error {
  readonly _tag = "StateError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StateError";
  }
}

export interface CurrentListingRecord extends SourcedFinding {
  readonly bellwatchKey: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly canonicalGroupKey?: string;
}

export interface ListingObservation {
  readonly observationId: string;
  readonly bellwatchKey: string;
  readonly observedAt: string;
  readonly listing: SourcedFinding;
}

export interface PendingBaserowListing extends CurrentListingRecord {
  readonly rowId: string | null;
  readonly revision: number;
}

export interface CurrentCandidateRecord {
  readonly candidateKey: string;
  readonly candidate: DiscoveryCandidate;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

export interface CandidateObservation {
  readonly observationId: string;
  readonly candidateKey: string;
  readonly observedAt: string;
  readonly candidate: DiscoveryCandidate;
}

export interface PendingBaserowCandidate extends CurrentCandidateRecord {
  readonly rowId: string | null;
  readonly revision: number;
}

export const REGISTRATION_STATUSES = [
  "confirmed",
  "unconfirmed",
  "failed",
  "skipped",
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const REGISTRATION_CONSENT_STATUSES = [
  "unknown",
  "consented",
  "declined",
  "not-applicable",
] as const;
export type RegistrationConsentStatus =
  (typeof REGISTRATION_CONSENT_STATUSES)[number];

export interface RegistrationEventInput {
  readonly status: RegistrationStatus;
  readonly consentStatus: RegistrationConsentStatus;
  readonly evidence: string;
  readonly recordedAt?: string;
}

export interface RegistrationEvent extends RegistrationEventInput {
  readonly eventId: string;
  readonly bellwatchKey: string;
  readonly recordedAt: string;
}

export interface StateStore {
  readonly isInitialized: () => Effect.Effect<boolean, StateError>;
  readonly markInitialized: () => Effect.Effect<void, StateError>;
  readonly isSeen: (
    id: string,
    canonicalGroupKey?: string,
  ) => Effect.Effect<boolean, StateError>;
  readonly markSeen: (
    finding: DaftFinding,
    canonicalGroupKey?: string,
  ) => Effect.Effect<void, StateError>;
  readonly observeFinding: (
    listing: SourcedFinding,
  ) => Effect.Effect<void, StateError>;
  readonly getCurrentListing: (
    bellwatchKey: string,
  ) => Effect.Effect<CurrentListingRecord | undefined, StateError>;
  readonly listCurrentListings: () => Effect.Effect<
    readonly CurrentListingRecord[],
    StateError
  >;
  readonly listListingObservations: (
    bellwatchKey: string,
  ) => Effect.Effect<readonly ListingObservation[], StateError>;
  readonly listPendingBaserowListings: () => Effect.Effect<
    readonly PendingBaserowListing[],
    StateError
  >;
  readonly markBaserowListingSynced: (
    bellwatchKey: string,
    rowId: string,
    revision: number,
  ) => Effect.Effect<void, StateError>;
  readonly recordCandidate: (
    candidate: DiscoveryCandidate,
  ) => Effect.Effect<void, StateError>;
  readonly listCurrentCandidates: () => Effect.Effect<
    readonly CurrentCandidateRecord[],
    StateError
  >;
  readonly listCandidateObservations: (
    candidateKey: string,
  ) => Effect.Effect<readonly CandidateObservation[], StateError>;
  readonly listPendingBaserowCandidates: () => Effect.Effect<
    readonly PendingBaserowCandidate[],
    StateError
  >;
  readonly markBaserowCandidateSynced: (
    candidateKey: string,
    rowId: string,
    revision: number,
  ) => Effect.Effect<void, StateError>;
  readonly recordRegistrationEvent: (
    bellwatchKey: string,
    event: RegistrationEventInput,
  ) => Effect.Effect<void, StateError>;
  readonly listRegistrationEvents: (
    bellwatchKey: string,
  ) => Effect.Effect<readonly RegistrationEvent[], StateError>;
  readonly close: () => Effect.Effect<void>;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS seen_listings (
    id TEXT PRIMARY KEY,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS seen_listing_groups (
    group_key TEXT PRIMARY KEY,
    first_seen_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS monitor_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    initialized_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS current_listings (
    bellwatch_key TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    finding_json TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    canonical_group_key TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS current_listings_group
    ON current_listings (canonical_group_key);
  CREATE TABLE IF NOT EXISTS listing_observations (
    observation_id TEXT PRIMARY KEY,
    bellwatch_key TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    finding_json TEXT NOT NULL,
    latitude REAL,
    longitude REAL
  );
  CREATE INDEX IF NOT EXISTS listing_observations_listing
    ON listing_observations (bellwatch_key, observed_at);
  CREATE TABLE IF NOT EXISTS baserow_outbox (
    bellwatch_key TEXT PRIMARY KEY,
    row_id TEXT,
    dirty INTEGER NOT NULL,
    revision INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS discovery_candidates (
    candidate_key TEXT PRIMARY KEY,
    candidate_json TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS candidate_observations (
    observation_id TEXT PRIMARY KEY,
    candidate_key TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    candidate_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS candidate_observations_candidate
    ON candidate_observations (candidate_key, observed_at);
  CREATE TABLE IF NOT EXISTS candidate_baserow_outbox (
    candidate_key TEXT PRIMARY KEY,
    row_id TEXT,
    dirty INTEGER NOT NULL,
    revision INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS registration_events (
    event_id TEXT PRIMARY KEY,
    bellwatch_key TEXT NOT NULL,
    status TEXT NOT NULL,
    evidence TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    consent_status TEXT NOT NULL DEFAULT 'unknown'
  );
  CREATE INDEX IF NOT EXISTS registration_events_listing
    ON registration_events (bellwatch_key, recorded_at);
`;

const withStateError = <A>(operation: string, action: () => A) =>
  Effect.try({
    try: action,
    catch: (cause) => new StateError(`State ${operation} failed`, { cause }),
  });

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  return value;
};

const canonicalJson = (value: unknown): string =>
  JSON.stringify(canonicalValue(value));
const nextObservationAt = (
  previous: string | undefined,
  now: string,
): string => {
  if (previous === undefined || Date.parse(previous) < Date.parse(now)) {
    return now;
  }
  return new Date(Date.parse(previous) + 1).toISOString();
};

const normalizeGroupingText = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s,._-]+/g, " ");

const groupKeyFor = (listing: SourcedFinding): string | undefined => {
  const { finding } = listing;
  const location = finding.eircode?.trim().replace(/\s+/g, "").toUpperCase();
  const address =
    finding.address === undefined
      ? undefined
      : normalizeGroupingText(finding.address);
  const propertyType =
    finding.propertyType === undefined
      ? undefined
      : normalizeGroupingText(finding.propertyType);
  const bedrooms = finding.bedrooms;
  const exactLocation = location
    ? `eircode:${location}`
    : address
      ? `address:${address}`
      : undefined;

  if (
    exactLocation === undefined ||
    propertyType === undefined ||
    propertyType.length === 0 ||
    bedrooms === undefined ||
    !Number.isFinite(bedrooms) ||
    bedrooms <= 0
  ) {
    return undefined;
  }
  return canonicalJson([exactLocation, propertyType, bedrooms]);
};

const candidateKeyFor = (candidate: DiscoveryCandidate): string => {
  const url = new URL(candidate.url);
  url.hash = "";
  return `searxng:${url.toString()}`;
};

interface ListingDbRow {
  readonly bellwatch_key: string;
  readonly finding_json: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly canonical_group_key: string | null;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
}

interface ListingOutboxDbRow extends ListingDbRow {
  readonly row_id: string | null;
  readonly revision: number;
}

interface ObservationDbRow {
  readonly observation_id: string;
  readonly bellwatch_key: string;
  readonly observed_at: string;
  readonly finding_json: string;
}

interface CandidateDbRow {
  readonly candidate_key: string;
  readonly candidate_json: string;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
}

interface CandidateOutboxDbRow extends CandidateDbRow {
  readonly row_id: string | null;
  readonly revision: number;
}

interface CandidateObservationDbRow {
  readonly observation_id: string;
  readonly candidate_key: string;
  readonly observed_at: string;
  readonly candidate_json: string;
}

interface RegistrationDbRow {
  readonly event_id: string;
  readonly bellwatch_key: string;
  readonly status: RegistrationStatus;
  readonly consent_status: RegistrationConsentStatus;
  readonly evidence: string;
  readonly recorded_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- query projections supply the caller's row contract.
const queryRow = <Row>(row: object): Row => {
  // Drivers expose query columns as generic records; each caller's SELECT defines the row shape.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return row as unknown as Row;
};

const queryRows = <Row>(rows: readonly object[]): Row[] =>
  rows.map((row) => queryRow<Row>(row));

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- state writes guarantee the caller-selected JSON type.
const parseStoredJson = <Value>(serialized: string): Value => {
  const value: unknown = JSON.parse(serialized) as unknown;
  // State JSON is written only by this application and versioned through its database schema.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return value as Value;
};

const allSqliteRows = <Row>(
  statement: StatementSync,
  ...parameters: string[]
): Row[] => queryRows<Row>(statement.all(...parameters));

const listingFromRow = (row: ListingDbRow): CurrentListingRecord => {
  const stored = parseStoredJson<SourcedFinding>(row.finding_json);
  return {
    ...stored,
    ...(row.latitude === null ? {} : { latitude: row.latitude }),
    ...(row.longitude === null ? {} : { longitude: row.longitude }),
    bellwatchKey: row.bellwatch_key,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    ...(row.canonical_group_key === null
      ? {}
      : { canonicalGroupKey: row.canonical_group_key }),
  };
};

const pendingListingFromRow = (
  row: ListingOutboxDbRow,
): PendingBaserowListing => ({
  ...listingFromRow(row),
  rowId: row.row_id,
  revision: row.revision,
});

const observationFromRow = (row: ObservationDbRow): ListingObservation => ({
  observationId: row.observation_id,
  bellwatchKey: row.bellwatch_key,
  observedAt: row.observed_at,
  listing: parseStoredJson<SourcedFinding>(row.finding_json),
});

const candidateFromRow = (row: CandidateDbRow): CurrentCandidateRecord => ({
  candidateKey: row.candidate_key,
  candidate: parseStoredJson<DiscoveryCandidate>(row.candidate_json),
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
});

const pendingCandidateFromRow = (
  row: CandidateOutboxDbRow,
): PendingBaserowCandidate => ({
  ...candidateFromRow(row),
  rowId: row.row_id,
  revision: row.revision,
});

const candidateObservationFromRow = (
  row: CandidateObservationDbRow,
): CandidateObservation => ({
  observationId: row.observation_id,
  candidateKey: row.candidate_key,
  observedAt: row.observed_at,
  candidate: parseStoredJson<DiscoveryCandidate>(row.candidate_json),
});

const registrationFromRow = (row: RegistrationDbRow): RegistrationEvent => ({
  eventId: row.event_id,
  bellwatchKey: row.bellwatch_key,
  status: row.status,
  consentStatus: row.consent_status,
  evidence: row.evidence,
  recordedAt: row.recorded_at,
});

const createSqliteStore = async (file: string): Promise<StateStore> => {
  await mkdir(dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  try {
    database.exec(SCHEMA);
    const registrationColumns = queryRows<{ readonly name: string }>(
      database.prepare("PRAGMA table_info(registration_events)").all(),
    );
    if (!registrationColumns.some((column) => column.name === "consent_status")) {
      database.exec(
        "ALTER TABLE registration_events ADD COLUMN consent_status TEXT NOT NULL DEFAULT 'unknown'",
      );
    }
    database.exec(`
      INSERT OR IGNORE INTO seen_listings (id, first_seen_at, last_seen_at)
      SELECT 'daft:' || id, first_seen_at, last_seen_at
      FROM seen_listings
      WHERE id NOT LIKE 'daft:%' AND id NOT LIKE 'myhome:%'
    `);
  } catch (error) {
    database.close();
    throw new StateError(`Could not initialize SQLite state at ${file}`, {
      cause: error,
    });
  }

  const observeFinding = (listing: SourcedFinding): void => {
    const key = sourcedFindingKey(listing);
    const now = new Date().toISOString();
    const findingJson = canonicalJson(listing);
    const canonicalGroupKey = groupKeyFor(listing) ?? null;
    const latitude = listing.latitude ?? null;
    const longitude = listing.longitude ?? null;
    const existingValue = database
      .prepare(
        `SELECT finding_json, latitude, longitude
         FROM current_listings WHERE bellwatch_key = ?`,
      )
      .get(key);
    const existing = existingValue === undefined
      ? undefined
      : queryRow<{ finding_json: string; latitude: number | null; longitude: number | null }>(existingValue);
    const changed =
      existing === undefined ||
      existing.finding_json !== findingJson ||
      existing.latitude !== latitude ||
      existing.longitude !== longitude;

    database
      .prepare(
        `INSERT INTO current_listings (
           bellwatch_key, source, source_id, finding_json, latitude, longitude,
           canonical_group_key, first_seen_at, last_seen_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(bellwatch_key) DO UPDATE SET
           finding_json = excluded.finding_json,
           latitude = excluded.latitude,
           longitude = excluded.longitude,
           canonical_group_key = excluded.canonical_group_key,
           last_seen_at = excluded.last_seen_at`,
      )
      .run(
        key,
        listing.source,
        listing.sourceId,
        findingJson,
        latitude,
        longitude,
        canonicalGroupKey,
        now,
        now,
      );
    if (changed) {
      const latestValue = database
        .prepare(
          `SELECT observed_at FROM listing_observations
           WHERE bellwatch_key = ? ORDER BY observed_at DESC LIMIT 1`,
        )
        .get(key);
      const latest = latestValue === undefined
        ? undefined
        : queryRow<{ observed_at: string }>(latestValue);
      database
        .prepare(
          `INSERT INTO listing_observations (
             observation_id, bellwatch_key, observed_at, finding_json, latitude, longitude
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          key,
          nextObservationAt(latest?.observed_at, now),
          findingJson,
          latitude,
          longitude,
        );
    }
    database
      .prepare(
        `INSERT INTO baserow_outbox (bellwatch_key, row_id, dirty, revision)
         VALUES (?, NULL, 1, 1)
         ON CONFLICT(bellwatch_key) DO UPDATE SET
           dirty = 1, revision = baserow_outbox.revision + 1`,
      )
      .run(key);
  };

  const recordCandidate = (candidate: DiscoveryCandidate): void => {
    const key = candidateKeyFor(candidate);
    const now = new Date().toISOString();
    const candidateJson = canonicalJson(candidate);
    const existingValue = database
      .prepare(
        "SELECT candidate_json FROM discovery_candidates WHERE candidate_key = ?",
      )
      .get(key);
    const existing = existingValue === undefined
      ? undefined
      : queryRow<{ candidate_json: string }>(existingValue);
    const changed =
      existing === undefined || existing.candidate_json !== candidateJson;

    database
      .prepare(
        `INSERT INTO discovery_candidates (
           candidate_key, candidate_json, first_seen_at, last_seen_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(candidate_key) DO UPDATE SET
           candidate_json = excluded.candidate_json,
           last_seen_at = excluded.last_seen_at`,
      )
      .run(key, candidateJson, now, now);
    if (changed) {
      const latestValue = database
        .prepare(
          `SELECT observed_at FROM candidate_observations
           WHERE candidate_key = ? ORDER BY observed_at DESC LIMIT 1`,
        )
        .get(key);
      const latest = latestValue === undefined
        ? undefined
        : queryRow<{ observed_at: string }>(latestValue);
      database
        .prepare(
          `INSERT INTO candidate_observations (
             observation_id, candidate_key, observed_at, candidate_json
           ) VALUES (?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          key,
          nextObservationAt(latest?.observed_at, now),
          candidateJson,
        );
    }
    database
      .prepare(
        `INSERT INTO candidate_baserow_outbox (candidate_key, row_id, dirty, revision)
         VALUES (?, NULL, 1, 1)
         ON CONFLICT(candidate_key) DO UPDATE SET
           dirty = 1, revision = candidate_baserow_outbox.revision + 1`,
      )
      .run(key);
  };


  return {
    isInitialized: () =>
      withStateError(
        "isInitialized",
        () =>
          database
            .prepare("SELECT 1 AS present FROM monitor_state WHERE id = 1")
            .get() !== undefined,
      ),
    markInitialized: () =>
      withStateError("markInitialized", () => {
        const now = new Date().toISOString();
        database
          .prepare(
            `INSERT INTO monitor_state (id, initialized_at)
             VALUES (1, ?)
             ON CONFLICT(id) DO UPDATE SET initialized_at = excluded.initialized_at`,
          )
          .run(now);
      }),
    isSeen: (id, canonicalGroupKey) =>
      withStateError("isSeen", () => {
        if (
          database
            .prepare("SELECT 1 AS present FROM seen_listings WHERE id = ? LIMIT 1")
            .get(id) !== undefined
        ) {
          return true;
        }
        return canonicalGroupKey !== undefined &&
          database
            .prepare("SELECT 1 AS present FROM seen_listing_groups WHERE group_key = ? LIMIT 1")
            .get(canonicalGroupKey) !== undefined;
      }),
    markSeen: (finding, canonicalGroupKey) =>
      withStateError("markSeen", () => {
        runSqliteTransaction(database, () => {
          const now = new Date().toISOString();
          database
            .prepare(
              `INSERT INTO seen_listings (id, first_seen_at, last_seen_at)
               VALUES (?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
            )
            .run(finding.id, now, now);
          if (canonicalGroupKey !== undefined) {
            database
              .prepare(
                `INSERT INTO seen_listing_groups (group_key, first_seen_at)
                 VALUES (?, ?) ON CONFLICT(group_key) DO NOTHING`,
              )
              .run(canonicalGroupKey, now);
          }
        });
      }),
    observeFinding: (listing) =>
      withStateError("observeFinding", () => {
        runSqliteTransaction(database, () => {
          observeFinding(listing);
        });
      }),
    getCurrentListing: (bellwatchKey) =>
      withStateError("getCurrentListing", () => {
        const rowValue = database
          .prepare(
            `SELECT bellwatch_key, finding_json, latitude, longitude,
                    canonical_group_key, first_seen_at, last_seen_at
             FROM current_listings WHERE bellwatch_key = ?`,
          )
          .get(bellwatchKey);
        const row = rowValue === undefined ? undefined : queryRow<ListingDbRow>(rowValue);
        return row === undefined ? undefined : listingFromRow(row);
      }),
    listCurrentListings: () =>
      withStateError("listCurrentListings", () =>
        allSqliteRows<ListingDbRow>(
          database.prepare(
            `SELECT bellwatch_key, finding_json, latitude, longitude,
                    canonical_group_key, first_seen_at, last_seen_at
             FROM current_listings ORDER BY first_seen_at, bellwatch_key`,
          ),
        ).map(listingFromRow),
      ),
    listListingObservations: (bellwatchKey) =>
      withStateError("listListingObservations", () =>
        allSqliteRows<ObservationDbRow>(
          database.prepare(
            `SELECT observation_id, bellwatch_key, observed_at, finding_json
             FROM listing_observations WHERE bellwatch_key = ?
             ORDER BY observed_at, observation_id`,
          ),
          bellwatchKey,
        ).map(observationFromRow),
      ),
    listPendingBaserowListings: () =>
      withStateError("listPendingBaserowListings", () =>
        allSqliteRows<ListingOutboxDbRow>(
          database.prepare(
            `SELECT current_listings.bellwatch_key, finding_json, latitude, longitude,
                    canonical_group_key, first_seen_at, last_seen_at,
                    baserow_outbox.row_id, baserow_outbox.revision
             FROM baserow_outbox
             JOIN current_listings USING (bellwatch_key)
             WHERE baserow_outbox.dirty = 1
             ORDER BY current_listings.first_seen_at, current_listings.bellwatch_key`,
          ),
        ).map(pendingListingFromRow),
      ),
    markBaserowListingSynced: (bellwatchKey, rowId, revision) =>
      withStateError("markBaserowListingSynced", () => {
        database
          .prepare(
            `UPDATE baserow_outbox SET
               row_id = ?,
               dirty = CASE WHEN revision = ? THEN 0 ELSE dirty END
             WHERE bellwatch_key = ?`,
          )
          .run(rowId, revision, bellwatchKey);
      }),
    recordCandidate: (candidate) =>
      withStateError("recordCandidate", () => {
        runSqliteTransaction(database, () => {
          recordCandidate(candidate);
        });
      }),
    listCurrentCandidates: () =>
      withStateError("listCurrentCandidates", () =>
        allSqliteRows<CandidateDbRow>(
          database.prepare(
            `SELECT candidate_key, candidate_json, first_seen_at, last_seen_at
             FROM discovery_candidates ORDER BY first_seen_at, candidate_key`,
          ),
        ).map(candidateFromRow),
      ),
    listCandidateObservations: (candidateKey) =>
      withStateError("listCandidateObservations", () =>
        allSqliteRows<CandidateObservationDbRow>(
          database.prepare(
            `SELECT observation_id, candidate_key, observed_at, candidate_json
             FROM candidate_observations WHERE candidate_key = ?
             ORDER BY observed_at, observation_id`,
          ),
          candidateKey,
        ).map(candidateObservationFromRow),
      ),
    listPendingBaserowCandidates: () =>
      withStateError("listPendingBaserowCandidates", () =>
        allSqliteRows<CandidateOutboxDbRow>(
          database.prepare(
            `SELECT discovery_candidates.candidate_key, candidate_json,
                    first_seen_at, last_seen_at,
                    candidate_baserow_outbox.row_id, candidate_baserow_outbox.revision
             FROM candidate_baserow_outbox
             JOIN discovery_candidates USING (candidate_key)
             WHERE candidate_baserow_outbox.dirty = 1
             ORDER BY discovery_candidates.first_seen_at, discovery_candidates.candidate_key`,
          ),
        ).map(pendingCandidateFromRow),
      ),
    markBaserowCandidateSynced: (candidateKey, rowId, revision) =>
      withStateError("markBaserowCandidateSynced", () => {
        database
          .prepare(
            `UPDATE candidate_baserow_outbox SET
               row_id = ?,
               dirty = CASE WHEN revision = ? THEN 0 ELSE dirty END
             WHERE candidate_key = ?`,
          )
          .run(rowId, revision, candidateKey);
      }),
    recordRegistrationEvent: (bellwatchKey, event) =>
      withStateError("recordRegistrationEvent", () => {
        runSqliteTransaction(database, () => {
          database
            .prepare(
              `INSERT INTO registration_events
               (event_id, bellwatch_key, status, consent_status, evidence, recorded_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
              randomUUID(),
              bellwatchKey,
              event.status,
              event.consentStatus,
              event.evidence,
              event.recordedAt ?? new Date().toISOString(),
            );
          database
            .prepare(
              `UPDATE baserow_outbox SET dirty = 1, revision = revision + 1
               WHERE bellwatch_key = ?`,
            )
            .run(bellwatchKey);
        });
      }),
    listRegistrationEvents: (bellwatchKey) =>
      withStateError("listRegistrationEvents", () =>
        allSqliteRows<RegistrationDbRow>(
          database.prepare(
            `SELECT event_id, bellwatch_key, status, consent_status, evidence, recorded_at
             FROM registration_events WHERE bellwatch_key = ?
             ORDER BY recorded_at, event_id`,
          ),
          bellwatchKey,
        ).map(registrationFromRow),
      ),
    close: () =>
      Effect.sync(() => {
        database.close();
      }),
  };
};

const runSqliteTransaction = <A>(
  database: DatabaseSync,
  operation: () => A,
): A => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const value = operation();
    database.exec("COMMIT");
    return value;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

const createPostgresStore = async (url: string): Promise<StateStore> => {
  const sql = postgres(url, { max: 1, connect_timeout: 10 });
  try {
    await sql.unsafe(SCHEMA);
    await sql.unsafe(
      "ALTER TABLE registration_events ADD COLUMN IF NOT EXISTS consent_status TEXT NOT NULL DEFAULT 'unknown'",
    );
    await sql.unsafe(`
      INSERT INTO seen_listings (id, first_seen_at, last_seen_at)
      SELECT 'daft:' || id, first_seen_at, last_seen_at
      FROM seen_listings
      WHERE id NOT LIKE 'daft:%' AND id NOT LIKE 'myhome:%'
      ON CONFLICT (id) DO NOTHING
    `);
  } catch (error) {
    await sql.end({ timeout: 5 });
    throw new StateError("Could not initialize Postgres state", { cause: error });
  }

  const observeFinding = async (listing: SourcedFinding): Promise<void> => {
    const key = sourcedFindingKey(listing);
    const now = new Date().toISOString();
    const findingJson = canonicalJson(listing);
    const canonicalGroupKey = groupKeyFor(listing) ?? null;
    const latitude = listing.latitude ?? null;
    const longitude = listing.longitude ?? null;

    await sql.begin(async (transaction) => {
      const rows = await transaction`
        SELECT finding_json, latitude, longitude
        FROM current_listings WHERE bellwatch_key = ${key}
      `;
      const existingRow = rows.at(0);
      const existing = existingRow === undefined
        ? undefined
        : queryRow<{ finding_json: string; latitude: number | null; longitude: number | null }>(existingRow);
      const changed =
        existing === undefined ||
        existing.finding_json !== findingJson ||
        existing.latitude !== latitude ||
        existing.longitude !== longitude;
      await transaction`
        INSERT INTO current_listings (
          bellwatch_key, source, source_id, finding_json, latitude, longitude,
          canonical_group_key, first_seen_at, last_seen_at
        ) VALUES (
          ${key}, ${listing.source}, ${listing.sourceId}, ${findingJson},
          ${latitude}, ${longitude}, ${canonicalGroupKey}, ${now}, ${now}
        )
        ON CONFLICT (bellwatch_key) DO UPDATE SET
          finding_json = EXCLUDED.finding_json,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          canonical_group_key = EXCLUDED.canonical_group_key,
          last_seen_at = EXCLUDED.last_seen_at
      `;
      if (changed) {
        const latestRows = await transaction`
          SELECT observed_at FROM listing_observations
          WHERE bellwatch_key = ${key}
          ORDER BY observed_at DESC LIMIT 1
        `;
        const latestRow = latestRows.at(0);
        const latest = latestRow === undefined
          ? undefined
          : queryRow<{ observed_at: string }>(latestRow);
        await transaction`
          INSERT INTO listing_observations (
            observation_id, bellwatch_key, observed_at, finding_json, latitude, longitude
          ) VALUES (
            ${randomUUID()}, ${key}, ${nextObservationAt(latest?.observed_at, now)},
            ${findingJson}, ${latitude}, ${longitude}
          )
        `;
      }
      await transaction`
        INSERT INTO baserow_outbox (bellwatch_key, row_id, dirty, revision)
        VALUES (${key}, NULL, 1, 1)
        ON CONFLICT (bellwatch_key) DO UPDATE SET
          dirty = 1, revision = baserow_outbox.revision + 1
      `;
    });
  };

  const recordCandidate = async (
    candidate: DiscoveryCandidate,
  ): Promise<void> => {
    const key = candidateKeyFor(candidate);
    const now = new Date().toISOString();
    const candidateJson = canonicalJson(candidate);
    await sql.begin(async (transaction) => {
      const rows = await transaction`
        SELECT candidate_json FROM discovery_candidates WHERE candidate_key = ${key}
      `;
      const existingRow = rows.at(0);
      const existing = existingRow === undefined
        ? undefined
        : queryRow<{ candidate_json: string }>(existingRow);
      const changed =
        existing === undefined || existing.candidate_json !== candidateJson;
      await transaction`
        INSERT INTO discovery_candidates
          (candidate_key, candidate_json, first_seen_at, last_seen_at)
        VALUES (${key}, ${candidateJson}, ${now}, ${now})
        ON CONFLICT (candidate_key) DO UPDATE SET
          candidate_json = EXCLUDED.candidate_json,
          last_seen_at = EXCLUDED.last_seen_at
      `;
      if (changed) {
        const latestRows = await transaction`
          SELECT observed_at FROM candidate_observations
          WHERE candidate_key = ${key}
          ORDER BY observed_at DESC LIMIT 1
        `;
        const latestRow = latestRows.at(0);
        const latest = latestRow === undefined
          ? undefined
          : queryRow<{ observed_at: string }>(latestRow);
        await transaction`
          INSERT INTO candidate_observations
            (observation_id, candidate_key, observed_at, candidate_json)
          VALUES (
            ${randomUUID()}, ${key}, ${nextObservationAt(latest?.observed_at, now)},
            ${candidateJson}
          )
        `;
      }
      await transaction`
        INSERT INTO candidate_baserow_outbox
          (candidate_key, row_id, dirty, revision)
        VALUES (${key}, NULL, 1, 1)
        ON CONFLICT (candidate_key) DO UPDATE SET
          dirty = 1, revision = candidate_baserow_outbox.revision + 1
      `;
    });
  };

  return {
    isInitialized: () =>
      Effect.tryPromise({
        try: async () => (await sql`SELECT 1 FROM monitor_state WHERE id = 1`).length > 0,
        catch: (cause) => new StateError("State isInitialized failed", { cause }),
      }),
    markInitialized: () =>
      Effect.tryPromise({
        try: async () => {
          const now = new Date().toISOString();
          await sql`
            INSERT INTO monitor_state (id, initialized_at)
            VALUES (1, ${now})
            ON CONFLICT (id) DO UPDATE SET initialized_at = EXCLUDED.initialized_at
          `;
        },
        catch: (cause) => new StateError("State markInitialized failed", { cause }),
      }),
    isSeen: (id, canonicalGroupKey) =>
      Effect.tryPromise({
        try: async () => {
          if ((await sql`SELECT 1 FROM seen_listings WHERE id = ${id} LIMIT 1`).length > 0) {
            return true;
          }
          return canonicalGroupKey !== undefined &&
            (await sql`
              SELECT 1 FROM seen_listing_groups
              WHERE group_key = ${canonicalGroupKey} LIMIT 1
            `).length > 0;
        },
        catch: (cause) => new StateError("State isSeen failed", { cause }),
      }),
    markSeen: (finding, canonicalGroupKey) =>
      Effect.tryPromise({
        try: async () => {
          const now = new Date().toISOString();
          await sql.begin(async (transaction) => {
            await transaction`
              INSERT INTO seen_listings (id, first_seen_at, last_seen_at)
              VALUES (${finding.id}, ${now}, ${now})
              ON CONFLICT (id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
            `;
            if (canonicalGroupKey !== undefined) {
              await transaction`
                INSERT INTO seen_listing_groups (group_key, first_seen_at)
                VALUES (${canonicalGroupKey}, ${now})
                ON CONFLICT (group_key) DO NOTHING
              `;
            }
          });
        },
        catch: (cause) => new StateError("State markSeen failed", { cause }),
      }),
    observeFinding: (listing) =>
      Effect.tryPromise({
        try: async () => observeFinding(listing),
        catch: (cause) => new StateError("State observeFinding failed", { cause }),
      }),
    getCurrentListing: (bellwatchKey) =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT bellwatch_key, finding_json, latitude, longitude,
                   canonical_group_key, first_seen_at, last_seen_at
            FROM current_listings WHERE bellwatch_key = ${bellwatchKey}
          `;
          const result = rows.at(0);
          const row = result === undefined ? undefined : queryRow<ListingDbRow>(result);
          return row === undefined ? undefined : listingFromRow(row);
        },
        catch: (cause) => new StateError("State getCurrentListing failed", { cause }),
      }),
    listCurrentListings: () =>
      Effect.tryPromise({
        try: async () =>
          queryRows<ListingDbRow>(await sql`
            SELECT bellwatch_key, finding_json, latitude, longitude,
                   canonical_group_key, first_seen_at, last_seen_at
            FROM current_listings ORDER BY first_seen_at, bellwatch_key
          `).map(listingFromRow),
        catch: (cause) => new StateError("State listCurrentListings failed", { cause }),
      }),
    listListingObservations: (bellwatchKey) =>
      Effect.tryPromise({
        try: async () =>
          queryRows<ObservationDbRow>(await sql`
            SELECT observation_id, bellwatch_key, observed_at, finding_json
            FROM listing_observations WHERE bellwatch_key = ${bellwatchKey}
            ORDER BY observed_at, observation_id
          `).map(observationFromRow),
        catch: (cause) =>
          new StateError("State listListingObservations failed", { cause }),
      }),
    listPendingBaserowListings: () =>
      Effect.tryPromise({
        try: async () =>
          queryRows<ListingOutboxDbRow>(await sql`
            SELECT current_listings.bellwatch_key, finding_json, latitude, longitude,
                   canonical_group_key, first_seen_at, last_seen_at,
                   baserow_outbox.row_id, baserow_outbox.revision
            FROM baserow_outbox
            JOIN current_listings USING (bellwatch_key)
            WHERE baserow_outbox.dirty = 1
            ORDER BY current_listings.first_seen_at, current_listings.bellwatch_key
          `).map(pendingListingFromRow),
        catch: (cause) =>
          new StateError("State listPendingBaserowListings failed", { cause }),
      }),
    markBaserowListingSynced: (bellwatchKey, rowId, revision) =>
      Effect.tryPromise({
        try: async () => {
          await sql`
            UPDATE baserow_outbox SET
              row_id = ${rowId},
              dirty = CASE WHEN revision = ${revision} THEN 0 ELSE dirty END
            WHERE bellwatch_key = ${bellwatchKey}
          `;
        },
        catch: (cause) =>
          new StateError("State markBaserowListingSynced failed", { cause }),
      }),
    recordCandidate: (candidate) =>
      Effect.tryPromise({
        try: async () => recordCandidate(candidate),
        catch: (cause) => new StateError("State recordCandidate failed", { cause }),
      }),
    listCurrentCandidates: () =>
      Effect.tryPromise({
        try: async () =>
          queryRows<CandidateDbRow>(await sql`
            SELECT candidate_key, candidate_json, first_seen_at, last_seen_at
            FROM discovery_candidates ORDER BY first_seen_at, candidate_key
          `).map(candidateFromRow),
        catch: (cause) => new StateError("State listCurrentCandidates failed", { cause }),
      }),
    listCandidateObservations: (candidateKey) =>
      Effect.tryPromise({
        try: async () =>
          queryRows<CandidateObservationDbRow>(await sql`
            SELECT observation_id, candidate_key, observed_at, candidate_json
            FROM candidate_observations WHERE candidate_key = ${candidateKey}
            ORDER BY observed_at, observation_id
          `).map(candidateObservationFromRow),
        catch: (cause) =>
          new StateError("State listCandidateObservations failed", { cause }),
      }),
    listPendingBaserowCandidates: () =>
      Effect.tryPromise({
        try: async () =>
          queryRows<CandidateOutboxDbRow>(await sql`
            SELECT discovery_candidates.candidate_key, candidate_json,
                   first_seen_at, last_seen_at,
                   candidate_baserow_outbox.row_id,
                   candidate_baserow_outbox.revision
            FROM candidate_baserow_outbox
            JOIN discovery_candidates USING (candidate_key)
            WHERE candidate_baserow_outbox.dirty = 1
            ORDER BY discovery_candidates.first_seen_at, discovery_candidates.candidate_key
          `).map(pendingCandidateFromRow),
        catch: (cause) =>
          new StateError("State listPendingBaserowCandidates failed", { cause }),
      }),
    markBaserowCandidateSynced: (candidateKey, rowId, revision) =>
      Effect.tryPromise({
        try: async () => {
          await sql`
            UPDATE candidate_baserow_outbox SET
              row_id = ${rowId},
              dirty = CASE WHEN revision = ${revision} THEN 0 ELSE dirty END
            WHERE candidate_key = ${candidateKey}
          `;
        },
        catch: (cause) =>
          new StateError("State markBaserowCandidateSynced failed", { cause }),
      }),
    recordRegistrationEvent: (bellwatchKey, event) =>
      Effect.tryPromise({
        try: async () => {
          await sql.begin(async (transaction) => {
            await transaction`
              INSERT INTO registration_events
                (event_id, bellwatch_key, status, consent_status, evidence, recorded_at)
              VALUES (
                ${randomUUID()}, ${bellwatchKey}, ${event.status},
                ${event.consentStatus}, ${event.evidence},
                ${event.recordedAt ?? new Date().toISOString()}
              )
            `;
            await transaction`
              UPDATE baserow_outbox SET dirty = 1, revision = revision + 1
              WHERE bellwatch_key = ${bellwatchKey}
            `;
          });
        },
        catch: (cause) =>
          new StateError("State recordRegistrationEvent failed", { cause }),
      }),
    listRegistrationEvents: (bellwatchKey) =>
      Effect.tryPromise({
        try: async () =>
          queryRows<RegistrationDbRow>(await sql`
            SELECT event_id, bellwatch_key, status, consent_status, evidence, recorded_at
            FROM registration_events WHERE bellwatch_key = ${bellwatchKey}
            ORDER BY recorded_at, event_id
          `).map(registrationFromRow),
        catch: (cause) =>
          new StateError("State listRegistrationEvents failed", { cause }),
      }),
    close: () =>
      Effect.promise(async () => {
        await sql.end({ timeout: 5 });
      }),
  };
};

export const createStateStore = (
  config: MonitorConfigLike,
): Effect.Effect<StateStore, StateError> => {
  const databaseUrl = config.databaseUrl;
  return databaseUrl !== undefined
    ? Effect.tryPromise({
        try: async () => createPostgresStore(databaseUrl),
        catch: (cause) =>
          cause instanceof StateError
            ? cause
            : new StateError("Could not open Postgres state", { cause }),
      })
    : Effect.tryPromise({
        try: async () => createSqliteStore(config.file),
        catch: (cause) =>
          cause instanceof StateError
            ? cause
            : new StateError("Could not open SQLite state", { cause }),
      });
};

interface MonitorConfigLike {
  readonly file: string;
  readonly databaseUrl?: string;
}
