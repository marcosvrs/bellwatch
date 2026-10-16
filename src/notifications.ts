import * as Effect from "effect/Effect";
import type { NotificationBackend } from "./config.js";
import type { DaftFinding } from "./daft/parser.js";
import type { ListingSource } from "./listings.js";

export interface NotificationDeliveryAdapters {
  readonly shoutrrr: {
    readonly finding: (
      finding: DaftFinding,
      source: ListingSource,
    ) => Effect.Effect<void, Error>;
    readonly message: (
      title: string,
      message: string,
    ) => Effect.Effect<void, Error>;
  };
  readonly hermes: {
    readonly finding: (
      finding: DaftFinding,
      source: ListingSource,
    ) => Effect.Effect<void, Error>;
    readonly message: (message: string) => Effect.Effect<void, Error>;
  };
}

type NotificationPublisher = () => Effect.Effect<void, Error>;

const formatPollError = (error: Error): string =>
  `Bellwatch poll failed\n${error.message.slice(0, 1_000)}`;

const publishToAll = (
  publishers: readonly NotificationPublisher[],
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const [failures] = yield* Effect.partition(
      publishers,
      (publisher) => publisher(),
      { concurrency: 1 },
    );
    const [firstFailure] = failures;
    if (firstFailure !== undefined) {
      yield* Effect.fail(firstFailure);
    }
  });

export const createNotificationDelivery = (
  backends: readonly NotificationBackend[],
  adapters: NotificationDeliveryAdapters,
) => ({
  publish: (
    finding: DaftFinding,
    source: ListingSource,
  ): Effect.Effect<void, Error> => {
    const publishers: NotificationPublisher[] = [];
    if (backends.includes("shoutrrr")) {
      publishers.push(() => adapters.shoutrrr.finding(finding, source));
    }
    if (backends.includes("hermes")) {
      publishers.push(() => adapters.hermes.finding(finding, source));
    }
    return publishToAll(publishers);
  },
  publishError: (error: Error): Effect.Effect<void, Error> => {
    const message = formatPollError(error);
    const publishers: NotificationPublisher[] = [];
    if (backends.includes("shoutrrr")) {
      publishers.push(() =>
        adapters.shoutrrr.message("Bellwatch error", message),
      );
    }
    if (backends.includes("hermes")) {
      publishers.push(() => adapters.hermes.message(message));
    }
    return publishToAll(publishers);
  },
});
