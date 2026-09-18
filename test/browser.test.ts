import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvironment } from "../src/config.js";
import {
  assertDaftHttpStatus,
  createDaftRequestGate,
  DEFAULT_BROWSER_USER_AGENT,
  resolveBrowserStrategy,
  resolveBrowserUserAgent,
} from "../src/browser.js";

const base = { SHOUTRRR_URL: "ntfy://ntfy.sh/daft" };

test("uses bundled Chromium without an endpoint", () => {
  const browser = parseEnvironment(base).browser;
  assert.equal(resolveBrowserStrategy(browser), "local");
});
test("uses a browser user-agent for direct and local browser requests", () => {
  assert.equal(
    resolveBrowserUserAgent(parseEnvironment(base).browser),
    DEFAULT_BROWSER_USER_AGENT,
  );
  assert.equal(
    resolveBrowserUserAgent(
      parseEnvironment({
        ...base,
        BROWSER_USER_AGENT: "CustomBrowser/1.0",
      }).browser,
    ),
    "CustomBrowser/1.0",
  );
});
test("uses an external Playwright/CDP endpoint when set", () => {
  const browser = parseEnvironment({
    ...base,
    PLAYWRIGHT_WS_ENDPOINT: "ws://browser-sockpuppet-chrome:3000",
  }).browser;
  assert.equal(resolveBrowserStrategy(browser), "external");
});

test("rejects an invalid Playwright/CDP endpoint", () => {
  assert.throws(
    () =>
      parseEnvironment({
        ...base,
        PLAYWRIGHT_WS_ENDPOINT: "http://browser.example",
      }),
    /PLAYWRIGHT_WS_ENDPOINT must use ws or wss/,
  );
});
test("accepts only HTTP 200 Daft pages", () => {
  assert.doesNotThrow(() => assertDaftHttpStatus(200));
  for (const status of [204, 403, 404, 500]) {
    assert.throws(
      () => assertDaftHttpStatus(status),
      new RegExp(`Daft page returned HTTP ${status}`),
    );
  }
  assert.throws(
    () => assertDaftHttpStatus(undefined),
    /Daft page returned HTTP no response/,
  );
});

test("paces Daft requests without sleeping before the first navigation", async () => {
  let now = 0;
  const waits: number[] = [];
  const gate = createDaftRequestGate(
    () => now,
    async (milliseconds) => {
      waits.push(milliseconds);
    },
  );

  await gate(1_000);
  now = 400;
  await gate(1_000);
  now = 1_400;
  await gate(1_000);

  assert.deepEqual(waits, [600]);
});
