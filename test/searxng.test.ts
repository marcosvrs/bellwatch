import assert from "node:assert/strict";
import test from "node:test";
import { requestUrl } from "./request-url.js";
import type { DaftFilters } from "../src/daft/filters.js";
import {
  buildSearxngQuery,
  searchSearxng,
  type SearxngSearchOptions,
} from "../src/searxng.js";

const filters: DaftFilters = {
  propertyTypes: ["houses", "detached-houses"],
  mediaTypes: [],
  availability: "published",
};

const activeInputs = {
  sectionPath: "new-homes-for-sale",
  locations: ["Dublin", "Galway"],
  filters,
} as const;

const jsonResponse = (
  payload: unknown,
  status = 200,
  contentType = "application/json; charset=utf-8",
): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": contentType },
  });

const searchOptions = (
  fetch: typeof globalThis.fetch,
  overrides: Partial<SearxngSearchOptions> = {},
): SearxngSearchOptions => ({
  ...activeInputs,
  baseUrl: "https://search.example/",
  fetch,
  ...overrides,
});

test("builds the JSON search request from the active section and filters", async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  const candidates = [{
    title: "New homes in Dublin",
    url: "https://builder.example/homes/1",
    content: "Three-bedroom home",
    engine: "example-engine",
  }];
  const result = await searchSearxng(searchOptions(async (input, init) => {
    requestedUrl = new URL(requestUrl(input));
    requestedInit = init;
    return jsonResponse({ results: candidates });
  }, {
    baseUrl: "https://search.example/searxng/",
    filters: { ...filters, keyword: "energy efficient", bedsMin: 3 },
    now: () => new Date("2026-10-01T12:30:00.000Z"),
  }));

  assert.ok(result.ok);
  assert.ok(requestedUrl);
  assert.equal(requestedUrl.pathname, "/searxng/search");
  assert.equal(requestedUrl.searchParams.get("format"), "json");
  assert.equal(requestedUrl.searchParams.get("language"), "en-IE");
  assert.equal(
    requestedUrl.searchParams.get("q"),
    'new homes for sale ("Dublin" OR "Galway") energy efficient (houses OR detached houses) 3+ bedrooms',
  );
  assert.equal(requestedInit?.method, "GET");
  assert.equal(new Headers(requestedInit.headers).get("accept"), "application/json");
  assert.deepEqual(result.candidates, [{
    title: "New homes in Dublin",
    url: "https://builder.example/homes/1",
    snippet: "Three-bedroom home",
    engine: "example-engine",
    source: "searxng",
    discoveredAt: "2026-10-01T12:30:00.000Z",
    verified: false,
  }]);
});

test("parses only supplied candidate fields without inventing property facts", async () => {
  const result = await searchSearxng(searchOptions(async () => jsonResponse({
    results: [{
      title: "Development page",
      url: "https://builder.example/development",
      content: "See the builder's development page.",
    }],
  }), { now: () => new Date("2026-10-01T00:00:00.000Z") }));

  assert.ok(result.ok);
  assert.deepEqual(result.candidates, [{
    title: "Development page",
    url: "https://builder.example/development",
    snippet: "See the builder's development page.",
    source: "searxng",
    discoveredAt: "2026-10-01T00:00:00.000Z",
    verified: false,
  }]);
});

test("builds a query with a single location and optional filter ranges", () => {
  const query = buildSearxngQuery({
    sectionPath: "property-for-rent",
    locations: ['Cork "City"'],
    filters: {
      ...filters,
      propertyTypes: [],
      bedsMin: 2,
      bedsMax: 2,
      bathsMax: 1,
      keyword: "  near transit  ",
    },
  });

  assert.equal(query, 'property for rent "Cork \\"City\\"" near transit 2 bedrooms up to 1 bathrooms');
});

test("returns an explicit error for malformed JSON and invalid result schemas", async () => {
  const malformedJson = await searchSearxng(searchOptions(async () =>
    new Response("{", { headers: { "content-type": "application/json" } }),
  ));
  assert.deepEqual(malformedJson, {
    ok: false,
    error: { code: "invalid-payload", message: "SearXNG returned malformed JSON" },
  });

  const invalidSchema = await searchSearxng(searchOptions(async () =>
    jsonResponse({ results: [{ title: "No URL", content: "not a candidate" }] }),
  ));
  assert.deepEqual(invalidSchema, {
    ok: false,
    error: { code: "invalid-payload", message: "SearXNG returned an invalid results payload" },
  });
  const malformedShape = await searchSearxng(searchOptions(async () =>
    jsonResponse({ results: "not an array" }),
  ));
  assert.deepEqual(malformedShape, {
    ok: false,
    error: { code: "invalid-payload", message: "SearXNG returned an invalid results payload" },
  });

});

test("rejects non-JSON responses when the instance has JSON search disabled", async () => {
  const result = await searchSearxng(searchOptions(async () =>
    jsonResponse("Forbidden", 403, "text/plain"),
  ));

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "json-disabled",
      message: "SearXNG JSON search is disabled",
      status: 403,
    },
  });
});

test("reports a successful HTML response as disabled JSON without parsing it", async () => {
  let jsonRead = false;
  const response = new Response("<html>search disabled</html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  response.json = async () => {
    jsonRead = true;
    return { results: [] };
  };
  const result = await searchSearxng(searchOptions(async () => response));

  assert.deepEqual(result, {
    ok: false,
    error: { code: "json-disabled", message: "SearXNG did not return JSON; JSON search may be disabled" },
  });
  assert.equal(jsonRead, false);
});

test("reports rate limiting without retrying", async () => {
  let requestCount = 0;
  const result = await searchSearxng(searchOptions(async () => {
    requestCount += 1;
    return jsonResponse({}, 429);
  }));

  assert.deepEqual(result, {
    ok: false,
    error: { code: "rate-limited", message: "SearXNG rate limit reached", status: 429 },
  });
  assert.equal(requestCount, 1);
});

test("returns explicit errors for invalid base URLs, request failures, and other HTTP errors", async () => {
  const invalidBase = await searchSearxng(searchOptions(async () => jsonResponse({ results: [] }), {
    baseUrl: "file:///tmp/searxng",
  }));
  assert.deepEqual(invalidBase, {
    ok: false,
    error: { code: "invalid-base-url", message: "SearXNG base URL must be an absolute HTTP(S) URL" },
  });
  const malformedBase = await searchSearxng(searchOptions(async () => jsonResponse({ results: [] }), {
    baseUrl: "not a URL",
  }));
  assert.deepEqual(malformedBase, {
    ok: false,
    error: { code: "invalid-base-url", message: "SearXNG base URL must be an absolute HTTP(S) URL" },
  });


  const requestFailure = await searchSearxng(searchOptions(async () => {
    throw new Error("network detail must not leak");
  }));
  assert.deepEqual(requestFailure, {
    ok: false,
    error: { code: "request-failed", message: "SearXNG request failed" },
  });

  const httpError = await searchSearxng(searchOptions(async () => jsonResponse({}, 503)));
  assert.deepEqual(httpError, {
    ok: false,
    error: {
      code: "http-error",
      message: "SearXNG returned an unsuccessful HTTP status",
      status: 503,
    },
  });
});

test("rejects invalid candidate schemas without emitting partial candidates", async () => {
  for (const resultItem of [
    { title: "Bad URL", url: "/relative", content: "Not an absolute URL" },
    { title: "Bad URL scheme", url: "ftp://builder.example/page", content: "Not HTTP(S)" },
    { title: "Bad engine", url: "https://builder.example/", content: "Snippet", engine: 42 },
    { title: "Bad snippet", url: "https://builder.example/", content: 42 },
    { title: "  ", url: "https://builder.example/", content: "Missing title" },
    null,
    [],
  ]) {
    const result = await searchSearxng(searchOptions(async () =>
      jsonResponse({ results: [resultItem] }),
    ));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "invalid-payload");
  }
});

test("omits results without a source-provided snippet", async () => {
  const result = await searchSearxng(searchOptions(async () => jsonResponse({
    results: [{ title: "Page without snippet", url: "https://builder.example/page" }],
  })));

  assert.deepEqual(result, { ok: true, candidates: [] });
});
