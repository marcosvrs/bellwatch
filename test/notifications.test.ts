import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import { formatPollError, publishToAll } from "../src/notifications.js";

test("publishes to every configured notification backend", async () => {
  const attempted: string[] = [];

  await Effect.runPromise(
    publishToAll([
      () => Effect.sync(() => attempted.push("shoutrrr")),
      () => Effect.sync(() => attempted.push("hermes")),
    ]),
  );

  assert.deepEqual(attempted, ["shoutrrr", "hermes"]);
});
test("formats poll errors without including nested causes", () => {
  const error = new Error("Daft page returned HTTP 404", {
    cause: new Error("private transport details"),
  });
  assert.equal(
    formatPollError(error),
    "Bellwatch poll failed\nDaft page returned HTTP 404",
  );
});

test("attempts every backend and preserves the first failure", async () => {
  const attempted: string[] = [];
  const firstFailure = new Error("Shoutrrr unavailable");

  await assert.rejects(
    Effect.runPromise(
      publishToAll([
        () =>
          Effect.gen(function* () {
            yield* Effect.sync(() => attempted.push("shoutrrr"));
            yield* Effect.fail(firstFailure);
          }),
        () => Effect.sync(() => attempted.push("hermes")),
      ]),
    ),
    firstFailure,
  );

  assert.deepEqual(attempted, ["shoutrrr", "hermes"]);
});
