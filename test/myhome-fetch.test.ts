import assert from "node:assert/strict";
import test from "node:test";
import { requestUrl } from "./request-url.js";
import {
  createMyHomePageFetcher,
  MyHomeFetchError,
} from "../src/myhome-fetch.js";

const options = (
  fetch: typeof globalThis.fetch,
  overrides: Partial<Parameters<typeof createMyHomePageFetcher>[0]> = {},
): Parameters<typeof createMyHomePageFetcher>[0] => ({
  baseUrl: "https://homes.example",
  userAgent: "Bellwatch-test/1.0",
  minimumDelayMs: 1_000,
  timeoutMs: 5_000,
  fetch,
  ...overrides,
});

const htmlResponse = (
  body: string,
  status = 200,
  contentType = "text/html; charset=utf-8",
): Response =>
  new Response(body, {
    status,
    headers: { "content-type": contentType },
  });

test("checks robots.txt, paces page requests, and caches robots policy", async () => {
  const requests: Array<{ url: string; userAgent: string | null }> = [];
  const delays: number[] = [];
  let now = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    requests.push({ url, userAgent: new Headers(init?.headers).get("user-agent") });
    return url.endsWith("/robots.txt")
      ? htmlResponse("User-agent: *\nAllow: /residential/")
      : htmlResponse("<html><body>listings</body></html>");
  };
  const fetchPage = createMyHomePageFetcher(options(fetch, {
    now: () => now,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
      now += milliseconds;
    },
  }));

  await fetchPage("https://homes.example/residential/ireland/new-homes/property-for-sale");
  await fetchPage("https://homes.example/residential/ireland/new-homes/property-for-sale?page=2");

  assert.deepEqual(requests.map(({ url }) => url), [
    "https://homes.example/robots.txt",
    "https://homes.example/residential/ireland/new-homes/property-for-sale",
    "https://homes.example/residential/ireland/new-homes/property-for-sale?page=2",
  ]);
  assert.ok(requests.every(({ userAgent }) => userAgent === "Bellwatch-test/1.0"));
  assert.deepEqual(delays, [1_000, 1_000]);
});

test("refuses robots-disallowed and off-origin pages without requesting them", async () => {
  const requested: string[] = [];
  const fetchPage = createMyHomePageFetcher(options(async (input) => {
    requested.push(requestUrl(input));
    return htmlResponse("User-agent: *\nDisallow: /residential/private");
  }, { sleep: async () => undefined }));

  await assert.rejects(
    fetchPage("https://homes.example/residential/private?page=2"),
    (error: unknown) =>
      error instanceof MyHomeFetchError &&
      /robots.txt disallows/.test(error.message),
  );
  await assert.rejects(
    fetchPage("https://other.example/residential/property-for-sale"),
    (error: unknown) =>
      error instanceof MyHomeFetchError &&
      /configured origin/.test(error.message),
  );
  assert.deepEqual(requested, ["https://homes.example/robots.txt"]);
});

test("does not retry MyHome rate limits or blocked responses", async () => {
  for (const status of [403, 429]) {
    let requestCount = 0;
    const fetchPage = createMyHomePageFetcher(options(async (input) => {
      requestCount += 1;
      return requestUrl(input).endsWith("/robots.txt")
        ? htmlResponse("User-agent: *\nAllow: /residential/")
        : htmlResponse("blocked", status);
    }, { sleep: async () => undefined }));

    await assert.rejects(
      fetchPage(`https://homes.example/residential/status-${status}`),
      (error: unknown) =>
        error instanceof MyHomeFetchError && error.status === status,
    );
    assert.equal(requestCount, 2);
  }
});

test("rejects non-HTML responses instead of parsing error payloads", async () => {
  const fetchPage = createMyHomePageFetcher(options(async (input) =>
    requestUrl(input).endsWith("/robots.txt")
      ? htmlResponse("User-agent: *\nAllow: /residential/")
      : htmlResponse("{\"error\":true}", 200, "application/json"),
  { sleep: async () => undefined }));

  await assert.rejects(
    fetchPage("https://homes.example/residential/property-for-sale"),
    (error: unknown) =>
      error instanceof MyHomeFetchError && /did not return HTML/.test(error.message),
  );
});
