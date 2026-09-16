import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as Effect from "effect/Effect";
import postgres from "postgres";
import type { DaftFinding } from "./daft/parser.js";

export class StateError extends Error {
  readonly _tag = "StateError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StateError";
  }
}

export interface StateStore {
  readonly isInitialized: () => Effect.Effect<boolean, StateError>;
  readonly markInitialized: () => Effect.Effect<void, StateError>;
  readonly isSeen: (id: string) => Effect.Effect<boolean, StateError>;
  readonly markSeen: (finding: DaftFinding) => Effect.Effect<void, StateError>;
  readonly close: () => Effect.Effect<void, never>;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS seen_listings (
    id TEXT PRIMARY KEY,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS monitor_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    initialized_at TEXT NOT NULL
  )
`;

const withStateError = <A>(operation: string, action: () => A) =>
  Effect.try({
    try: action,
    catch: (cause) => new StateError(`State ${operation} failed`, { cause }),
  });

const createSqliteStore = async (file: string): Promise<StateStore> => {
  await mkdir(dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  try {
    database.exec(SCHEMA);
  } catch (error) {
    database.close();
    throw new StateError(`Could not initialize SQLite state at ${file}`, {
      cause: error,
    });
  }

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
    isSeen: (id) =>
      withStateError(
        "isSeen",
        () =>
          database
            .prepare("SELECT 1 AS present FROM seen_listings WHERE id = ? LIMIT 1")
            .get(id) !== undefined,
      ),
    markSeen: (finding) =>
      withStateError("markSeen", () => {
        const now = new Date().toISOString();
        database
          .prepare(
            `INSERT INTO seen_listings (id, first_seen_at, last_seen_at)
             VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
          )
          .run(finding.id, now, now);
      }),
    close: () =>
      Effect.sync(() => {
        database.close();
      }),
  };
};

const createPostgresStore = async (url: string): Promise<StateStore> => {
  const sql = postgres(url, { max: 1, connect_timeout: 10 });
  try {
    await sql.unsafe(SCHEMA);
  } catch (error) {
    await sql.end({ timeout: 5 });
    throw new StateError("Could not initialize Postgres state", { cause: error });
  }

  return {
    isInitialized: () =>
      Effect.tryPromise({
        try: async () =>
          (await sql`SELECT 1 FROM monitor_state WHERE id = 1`).length > 0,
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
    isSeen: (id) =>
      Effect.tryPromise({
        try: async () =>
          (await sql`SELECT 1 FROM seen_listings WHERE id = ${id} LIMIT 1`).length > 0,
        catch: (cause) => new StateError("State isSeen failed", { cause }),
      }),
    markSeen: (finding) =>
      Effect.tryPromise({
        try: async () => {
          const now = new Date().toISOString();
          await sql`
            INSERT INTO seen_listings (id, first_seen_at, last_seen_at)
            VALUES (${finding.id}, ${now}, ${now})
            ON CONFLICT (id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
          `;
        },
        catch: (cause) => new StateError("State markSeen failed", { cause }),
      }),
    close: () =>
      Effect.promise(async () => {
        await sql.end({ timeout: 5 });
      }),
  };
};

export const createStateStore = (
  config: MonitorConfigLike,
): Effect.Effect<StateStore, StateError> =>
  config.databaseUrl
    ? Effect.tryPromise({
        try: () => createPostgresStore(config.databaseUrl!),
        catch: (cause) =>
          cause instanceof StateError
            ? cause
            : new StateError("Could not open Postgres state", { cause }),
      })
    : Effect.tryPromise({
        try: () => createSqliteStore(config.file),
        catch: (cause) =>
          cause instanceof StateError
            ? cause
            : new StateError("Could not open SQLite state", { cause }),
      });

export interface MonitorConfigLike {
  readonly file: string;
  readonly databaseUrl?: string;
}
