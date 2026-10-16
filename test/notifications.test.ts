import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import type { DaftFinding } from "../src/daft/parser.js";
import {
  createNotificationDelivery,
  type NotificationDeliveryAdapters,
} from "../src/notifications.js";

const finding: DaftFinding = {
  id: "101",
  title: "Contract home",
  developmentTitle: "Contract homes",
  priceText: "€315,000",
  url: "https://www.daft.ie/new-home-for-sale/contract/101",
};

interface RecordedMessage {
  readonly backend: string;
  readonly title: string | undefined;
  readonly message: string;
}

const recordingAdapters = (
  calls: string[],
  messages: RecordedMessage[],
): NotificationDeliveryAdapters => ({
  shoutrrr: {
    finding: () =>
      Effect.sync(() => {
        calls.push("shoutrrr:finding");
      }),
    message: (title, message) =>
      Effect.sync(() => {
        calls.push("shoutrrr:message");
        messages.push({ backend: "shoutrrr", title, message });
      }),
  },
  hermes: {
    finding: () =>
      Effect.sync(() => {
        calls.push("hermes:finding");
      }),
    message: (message) =>
      Effect.sync(() => {
        calls.push("hermes:message");
        messages.push({ backend: "hermes", title: undefined, message });
      }),
  },
});

test("routes both listing and poll-error notifications to enabled backends", async () => {
  const calls: string[] = [];
  const messages: RecordedMessage[] = [];
  const delivery = createNotificationDelivery(
    ["hermes", "shoutrrr"],
    recordingAdapters(calls, messages),
  );

  await Effect.runPromise(delivery.publish(finding, "myhome"));
  const error = new Error("x".repeat(1_001), {
    cause: new Error("private transport detail"),
  });
  await Effect.runPromise(delivery.publishError(error));

  const formattedError = `Bellwatch poll failed\n${"x".repeat(1_000)}`;
  assert.deepEqual(calls, [
    "shoutrrr:finding",
    "hermes:finding",
    "shoutrrr:message",
    "hermes:message",
  ]);
  assert.deepEqual(messages, [
    { backend: "shoutrrr", title: "Bellwatch error", message: formattedError },
    { backend: "hermes", title: undefined, message: formattedError },
  ]);
});

test("attempts every enabled backend and preserves the first delivery failure", async () => {
  const attempted: string[] = [];
  const firstFailure = new Error("Shoutrrr unavailable");
  const adapters = recordingAdapters(attempted, []);
  const delivery = createNotificationDelivery(["shoutrrr", "hermes"], {
    ...adapters,
    shoutrrr: {
      ...adapters.shoutrrr,
      finding: () =>
        Effect.gen(function* () {
          yield* Effect.sync(() => attempted.push("shoutrrr:finding"));
          yield* Effect.fail(firstFailure);
        }),
    },
  });

  await assert.rejects(
    Effect.runPromise(delivery.publish(finding, "daft")),
    firstFailure,
  );

  assert.deepEqual(attempted, ["shoutrrr:finding", "hermes:finding"]);
});

test("does not invoke a disabled notification backend", async () => {
  const calls: string[] = [];
  const delivery = createNotificationDelivery(
    ["hermes"],
    recordingAdapters(calls, []),
  );

  await Effect.runPromise(delivery.publish(finding, "daft"));

  assert.deepEqual(calls, ["hermes:finding"]);
});
