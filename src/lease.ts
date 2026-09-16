import { randomUUID } from "node:crypto";
import * as Effect from "effect/Effect";
import { createClient } from "redis";

export class LeaseError extends Error {
  readonly _tag = "LeaseError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LeaseError";
  }
}

export interface Lease {
  readonly acquire: () => Effect.Effect<boolean, LeaseError>;
  readonly release: () => Effect.Effect<void, never>;
  readonly close: () => Effect.Effect<void, never>;
}

export interface RedisLeaseConfig {
  readonly url: string;
  readonly lockKey: string;
  readonly lockTtlMs: number;
}

const RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  end
  return 0
`;

const createNoopLease = (): Lease => ({
  acquire: () => Effect.succeed(true),
  release: () => Effect.void,
  close: () => Effect.void,
});

export const createLease = (
  config: RedisLeaseConfig | undefined,
): Effect.Effect<Lease, LeaseError> => {
  if (!config) return Effect.succeed(createNoopLease());

  return Effect.tryPromise({
    try: async () => {
      const client = createClient({ url: config.url });
      client.on("error", (error) => {
        console.error("Redis client error", error);
      });
      await client.connect();
      const token = randomUUID();
      let held = false;
      return {
        acquire: () =>
          Effect.tryPromise({
            try: async () => {
              const result = await client.set(config.lockKey, token, {
                NX: true,
                PX: config.lockTtlMs,
              });
              held = result === "OK";
              return held;
            },
            catch: (cause) => new LeaseError("Redis lease acquire failed", { cause }),
          }),
        release: () =>
          Effect.promise(async () => {
            try {
              if (held) {
                await client.eval(RELEASE_SCRIPT, {
                  keys: [config.lockKey],
                  arguments: [token],
                });
              }
            } finally {
              held = false;
            }
          }),
        close: () =>
          Effect.promise(async () => {
            try {
              if (client.isOpen) await client.quit();
            } catch {
              // Redis is an optional coordination resource.
            }
          }),
      } satisfies Lease;
    },
    catch: (cause) =>
      cause instanceof LeaseError
        ? cause
        : new LeaseError("Could not connect to Redis", { cause }),
  });
};
