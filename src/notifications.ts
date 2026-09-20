import * as Effect from "effect/Effect";

export type NotificationPublisher = () => Effect.Effect<void, Error>;
export const formatPollError = (error: unknown): string => {
  const detail = error instanceof Error ? error.message : String(error);
  return `Bellwatch poll failed\n${detail.slice(0, 1_000)}`;
};

export const publishToAll = (
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
