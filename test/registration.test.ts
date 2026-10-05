import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as Effect from "effect/Effect";
import {
  parseManualRegistrationArguments,
  recordManualRegistration,
  runManualRegistrationCommand,
} from "../src/registration.js";
import { createStateStore } from "../src/state.js";
import type { SourcedFinding } from "../src/listings.js";

const validArguments = [
  "--listing=daft:101",
  "--status=confirmed",
  "--consent=unknown",
  "--evidence=Provider page confirmed receipt",
];

const sampleListing: SourcedFinding = {
  source: "daft",
  sourceId: "101",
  finding: {
    id: "101",
    title: "Example house",
    developmentTitle: "Example house",
    priceText: "POA",
    bedrooms: 3,
    propertyType: "House",
    url: "https://www.daft.ie/new-home-for-sale/example/101",
  },
};

test("parses explicit manual status, consent, and evidence arguments", () => {
  assert.deepEqual(parseManualRegistrationArguments(validArguments), {
    listingKey: "daft:101",
    status: "confirmed",
    consentStatus: "unknown",
    evidence: "Provider page confirmed receipt",
  });
  assert.throws(() => parseManualRegistrationArguments([]), /Missing required argument/);
  assert.throws(
    () => parseManualRegistrationArguments([...validArguments, "--listing=daft:102"]),
    /Duplicate argument/,
  );
  assert.throws(
    () => parseManualRegistrationArguments([...validArguments, "--unknown=value"]),
    /Unexpected argument/,
  );
  assert.throws(
    () => parseManualRegistrationArguments(["--listing=daft:101", "--status"]),
    /Unexpected argument/,
  );
  assert.throws(
    () => parseManualRegistrationArguments(validArguments.map((arg) =>
      arg.startsWith("--listing=") ? "--listing=other:101" : arg,
    )),
    /namespaced key/,
  );
  assert.throws(
    () => parseManualRegistrationArguments(validArguments.map((arg) =>
      arg.startsWith("--status=") ? "--status=eligible" : arg,
    )),
    /--status must be one of/,
  );
  assert.throws(
    () => parseManualRegistrationArguments(validArguments.map((arg) =>
      arg.startsWith("--consent=") ? "--consent=automatic" : arg,
    )),
    /--consent must be one of/,
  );
  assert.throws(
    () => parseManualRegistrationArguments(validArguments.map((arg) =>
      arg.startsWith("--evidence=") ? "--evidence=  " : arg,
    )),
    /evidence must contain/,
  );
});

test("records only user-entered registration evidence against an existing listing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bellwatch-manual-registration-"));
  const file = join(directory, "state.sqlite");
  const stateConfig = { file, heartbeatFile: join(directory, "heartbeat") };
  let state = await Effect.runPromise(createStateStore(stateConfig));
  try {
    await Effect.runPromise(state.observeFinding(sampleListing));
    await Effect.runPromise(state.close());

    const output: string[] = [];
    await runManualRegistrationCommand(validArguments, stateConfig, (message) => {
      output.push(message);
    });
    assert.deepEqual(output, [
      "Recorded manual registration history for daft:101: confirmed; consent=unknown",
    ]);

    state = await Effect.runPromise(createStateStore(stateConfig));
    const events = await Effect.runPromise(state.listRegistrationEvents("daft:101"));
    assert.equal(events.length, 1);
    const event = events.at(0);
    assert.ok(event);
    assert.equal(event.status, "confirmed");
    assert.equal(event.consentStatus, "unknown");
    assert.equal(event.evidence, "Provider page confirmed receipt");

    const invalidStatus = {
      listingKey: "daft:101",
      status: "eligible",
      consentStatus: "unknown",
      evidence: "Manual note",
    };
    await assert.rejects(
      Effect.runPromise(recordManualRegistration(state, invalidStatus)),
      /Invalid manual registration status/,
    );
    const invalidConsent = {
      ...invalidStatus,
      status: "confirmed",
      consentStatus: "automatic",
    };
    await assert.rejects(
      Effect.runPromise(recordManualRegistration(state, invalidConsent)),
      /Invalid manual consent status/,
    );
    await assert.rejects(
      Effect.runPromise(
        recordManualRegistration(state, {
          listingKey: "daft:101",
          status: "confirmed",
          consentStatus: "unknown",
          evidence: "  ",
        }),
      ),
      /Manual evidence note cannot be empty/,
    );
    await assert.rejects(
      runManualRegistrationCommand(
        validArguments.map((arg) =>
          arg.startsWith("--listing=") ? "--listing=daft:404" : arg,
        ),
        stateConfig,
        () => {},
      ),
      /No current listing exists/,
    );
  } finally {
    await Effect.runPromise(state.close());
    await rm(directory, { recursive: true, force: true });
  }
});
