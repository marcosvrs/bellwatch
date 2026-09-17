import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvironment } from "../src/config.js";
import { resolveBrowserStrategy } from "../src/browser.js";

const base = { SHOUTRRR_URL: "ntfy://ntfy.sh/daft" };

test("auto browser mode uses bundled Chromium without an endpoint", () => {
  const browser = parseEnvironment(base).browser;
  assert.equal(resolveBrowserStrategy(browser), "local");
});

test("auto browser mode uses an external Playwright/CDP endpoint when set", () => {
  const browser = parseEnvironment({
    ...base,
    PLAYWRIGHT_WS_ENDPOINT: "ws://browser-sockpuppet-chrome:3000",
  }).browser;
  assert.equal(resolveBrowserStrategy(browser), "external");
});

test("external mode requires a websocket endpoint", () => {
  assert.throws(
    () => parseEnvironment({ ...base, BROWSER_MODE: "external" }),
    /PLAYWRIGHT_WS_ENDPOINT is required/,
  );
});
