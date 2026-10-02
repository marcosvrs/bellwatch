import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as Effect from "effect/Effect";
import { BaserowSyncError, syncBaserow } from "../src/baserow.js";
import type { DiscoveryCandidate, SourcedFinding } from "../src/listings.js";
import { createStateStore } from "../src/state.js";
import { requestUrl } from "./request-url.js";


const parseObjectJson = (serialized: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(serialized) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected a JSON object");
  }
  const fields: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    fields[key] = Reflect.get(value, key) as unknown;
  }
  return fields;
};

interface RecordedCall {
  readonly method: string;
  readonly url: URL;
  readonly authorization?: string | null | undefined;
  readonly body: Record<string, unknown> | undefined;
}

const callAt = (
  calls: readonly RecordedCall[],
  index: number,
): RecordedCall => {
  const call = calls.at(index);
  if (call === undefined) { throw new Error(`Expected request ${index}`); }
  return call;
};

const bodyAt = (
  calls: readonly RecordedCall[],
  index: number,
): Record<string, unknown> => {
  const body = callAt(calls, index).body;
  if (body === undefined) { throw new Error(`Expected JSON body for request ${index}`); }
  return body;
};

test("Baserow retries after a lost create response and updates its stable row", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bellwatch-baserow-"));
  const file = join(directory, "state.sqlite");
  let state = await Effect.runPromise(createStateStore({ file }));
  const listing: SourcedFinding = {
    source: "myhome",
    sourceId: "unit-72",
    latitude: 53.35,
    longitude: -6.26,
    dublinBoundary: {
      status: "classified",
      insideCounty: true,
      nearestBoundaryDistanceKm: 1.2,
      withinDublin20Km: true,
    },
    finding: {
      id: "unit-72",
      title: "Three-bedroom house",
      developmentTitle: "Example Grove",
      priceText: "€340,000",
      bedrooms: 3,
      bathrooms: 2,
      propertyType: "House",
      floorSizeSqm: 120,
      berRating: "A2",
      address: "1 Example Grove",
      eircode: "D01 AB12",
      schemeText: "Help to Buy subject to eligibility.",
      url: "https://www.myhome.ie/residential/example/72",
    },
  };
  const token = "test-token-not-for-logs";
  const calls: RecordedCall[] = [];
  let remoteRow: Record<string, unknown> | undefined;
  let loseFirstCreateResponse = true;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(requestUrl(input));
    const method = init?.method ?? "GET";
    const requestBody = init?.body;
    const body = requestBody === undefined
      ? undefined
      : typeof requestBody === "string"
        ? parseObjectJson(requestBody)
        : (() => { throw new TypeError("Expected a JSON request body"); })();
    calls.push({
      method,
      url,
      authorization: new Headers(init?.headers).get("Authorization"),
      body,
    });

    if (method === "GET") {
      const key = url.searchParams.get("filter__bellwatch_key__equal");
      const results =
        remoteRow?.["bellwatch_key"] === key && key !== null ? [remoteRow] : [];
      return new Response(JSON.stringify({ count: results.length, results }), {
        status: 200,
      });
    }
    if (method === "POST") {
      remoteRow = { id: 72, ...body };
      if (loseFirstCreateResponse) {
        loseFirstCreateResponse = false;
        return new Response("temporary upstream failure", { status: 503 });
      }
      return new Response(JSON.stringify(remoteRow), { status: 201 });
    }
    remoteRow = { ...remoteRow, ...body };
    return new Response(JSON.stringify(remoteRow), { status: 200 });
  };

  try {
    await Effect.runPromise(state.observeFinding(listing));
    const options = {
      baseUrl: "https://baserow.example.test",
      token,
      tableId: "listings-table",
      state,
      fetch: fakeFetch,
    };

    await assert.rejects(
      Effect.runPromise(syncBaserow(options)),
      (error: unknown) =>
        error instanceof BaserowSyncError && /HTTP 503/.test(error.message),
    );
    const pendingAfterFailure = await Effect.runPromise(
      state.listPendingBaserowListings(),
    );
    assert.equal(pendingAfterFailure.length, 1);
    assert.equal(pendingAfterFailure[0]?.rowId, null);

    await Effect.runPromise(syncBaserow(options));
    assert.deepEqual(
      calls.map((call) => call.method),
      ["GET", "POST", "GET", "PATCH"],
    );
    assert.equal(callAt(calls, 0).authorization, `Token ${token}`);
    assert.equal(bodyAt(calls, 1)["bellwatch_key"], "myhome:unit-72");
    assert.equal(bodyAt(calls, 1)["source_url"], listing.finding.url);
    assert.equal(bodyAt(calls, 1)["price_text"], "€340,000");
    assert.equal(bodyAt(calls, 1)["latitude"], 53.35);
    assert.equal(callAt(calls, 1).url.pathname, "/api/database/rows/table/listings-table/");
    assert.equal(bodyAt(calls, 1)["floor_size_sqm"], 120);
    assert.equal(bodyAt(calls, 1)["help_to_buy_evidence_status"], "mentioned");
    assert.equal(bodyAt(calls, 1)["dublin_status"], "classified");
    assert.equal(bodyAt(calls, 1)["dublin_in_county"], true);
    assert.equal(bodyAt(calls, 1)["dublin_boundary_distance_km"], 1.2);
    assert.equal(bodyAt(calls, 1)["dublin_within_20km"], true);
    assert.equal(callAt(calls, 3).url.pathname, "/api/database/rows/table/listings-table/72/");
    assert.equal(bodyAt(calls, 3)["bellwatch_key"], "myhome:unit-72");
    assert.equal(
      (await Effect.runPromise(state.listPendingBaserowListings())).length,
      0,
    );
    await Effect.runPromise(syncBaserow(options));
    assert.equal(calls.length, 4);
    await Effect.runPromise(
      state.recordRegistrationEvent("myhome:unit-72", {
        status: "confirmed",
        consentStatus: "unknown",
        evidence: "Provider confirmed receipt.",
      }),
    );
    await Effect.runPromise(syncBaserow(options));
    assert.equal(callAt(calls, 4).method, "PATCH");
    assert.equal(bodyAt(calls, 4)["registration_status"], "confirmed");
    assert.equal(bodyAt(calls, 4)["registration_consent_status"], "unknown");
    assert.equal(
      bodyAt(calls, 4)["registration_evidence"],
      "Provider confirmed receipt.",
    );
    assert.match(
      String(bodyAt(calls, 4)["registration_history_json"]),
      /"status":"confirmed"/,
    );
    await Effect.runPromise(state.close());
    state = await Effect.runPromise(createStateStore({ file }));

    await Effect.runPromise(
      state.observeFinding({
        ...listing,
        finding: { ...listing.finding, priceText: "€355,000" },
      }),
    );
    await Effect.runPromise(syncBaserow({ ...options, state }));
    assert.equal(callAt(calls, 5).method, "PATCH");
    assert.equal(callAt(calls, 5).url.pathname, "/api/database/rows/table/listings-table/72/");
    assert.equal(bodyAt(calls, 5)["price_text"], "€355,000");
    assert.equal(remoteRow?.["price_text"], "€355,000");
    assert.equal(
      (await Effect.runPromise(state.listPendingBaserowListings())).length,
      0,
    );
  } finally {
    await Effect.runPromise(state.close());
    await rm(directory, { recursive: true, force: true });
  }
});

test("discovery candidates require and use a separate Baserow table", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bellwatch-candidates-"));
  const file = join(directory, "state.sqlite");
  const state = await Effect.runPromise(createStateStore({ file }));
  const candidate: DiscoveryCandidate = {
    source: "searxng",
    verified: false,
    url: "https://example.test/new-homes/development",
    title: "Possible new homes",
    snippet: "Search result only; details are not verified.",
    engine: "test-engine",
    discoveredAt: "2026-10-01T10:00:00.000Z",
  };
  const calls: RecordedCall[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(requestUrl(input));
    const method = init?.method ?? "GET";
    const requestBody = init?.body;
    const body = requestBody === undefined
      ? undefined
      : typeof requestBody === "string"
        ? parseObjectJson(requestBody)
        : (() => { throw new TypeError("Expected a JSON request body"); })();
    calls.push({ url, method, body });
    return method === "GET"
      ? new Response(JSON.stringify({ count: 0, results: [] }), { status: 200 })
      : new Response(JSON.stringify({ id: 29, ...body }), { status: 201 });
  };

  try {
    await Effect.runPromise(state.recordCandidate(candidate));
    const common = {
      baseUrl: "https://baserow.example.test",
      token: "candidate-test-token",
      tableId: "property-listings",
      state,
      fetch: fakeFetch,
    };
    await assert.rejects(
      Effect.runPromise(syncBaserow(common)),
      (error: unknown) =>
        error instanceof BaserowSyncError && /separate candidateTableId/.test(error.message),
    );
    assert.equal(calls.length, 0);

    await Effect.runPromise(
      syncBaserow({ ...common, candidateTableId: "discovery-candidates" }),
    );
    assert.equal(calls.length, 2);
    assert.equal(callAt(calls, 0).url.pathname, "/api/database/rows/table/discovery-candidates/");
    assert.equal(
      bodyAt(calls, 1)["candidate_key"],
      "searxng:https://example.test/new-homes/development",
    );
    assert.equal(bodyAt(calls, 1)["verified"], false);
    assert.equal(bodyAt(calls, 1)["source"], "searxng");
    assert.equal(
      (await Effect.runPromise(state.listPendingBaserowCandidates())).length,
      0,
    );
  } finally {
    await Effect.runPromise(state.close());
    await rm(directory, { recursive: true, force: true });
  }
});
