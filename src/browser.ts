import * as Effect from "effect/Effect";
import { setTimeout as sleep } from "node:timers/promises";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import type { MonitorConfig } from "./config.js";
import { isRobotsAllowed } from "./daft/robots.js";
interface BrowserErrorOptions extends ErrorOptions {
  readonly status?: number;
  readonly retryAfterMs?: number;
}

class BrowserError extends Error {
  readonly _tag = "BrowserError";
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, options?: BrowserErrorOptions) {
    super(message, options);
    this.name = "BrowserError";
    this.status = options?.status;
    this.retryAfterMs = options?.retryAfterMs;
  }
}
export const DEFAULT_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

export const resolveBrowserUserAgent = (
  browser: MonitorConfig["browser"],
): string => browser.userAgent ?? DEFAULT_BROWSER_USER_AGENT;

type BrowserStrategy = "external" | "local";

export const resolveBrowserStrategy = (
  browser: MonitorConfig["browser"],
): BrowserStrategy => (browser.externalEndpoint ? "external" : "local");

export const assertDaftHttpStatus = (
  status: number | undefined,
  retryAfterMs?: number,
): void => {
  if (status !== 200) {
    throw new BrowserError(
      `Daft page returned HTTP ${status === undefined ? "no response" : status}`,
      { status, retryAfterMs },
    );
  }
};
const BROWSER_IDLE_CLOSE_MS = 30_000;
const MAX_DAFT_HTTP_RETRIES = 2;
const DAFT_429_BACKOFF_MS = 30_000;
const MAX_DAFT_RETRY_DELAY_MS = 120_000;

const parseRetryAfterMs = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, MAX_DAFT_RETRY_DELAY_MS);
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? undefined
    : Math.min(
        Math.max(0, timestamp - Date.now()),
        MAX_DAFT_RETRY_DELAY_MS,
      );
};

const retryDelayMs = (
  config: MonitorConfig,
  error: BrowserError,
  attempt: number,
): number =>
  Math.min(
    MAX_DAFT_RETRY_DELAY_MS,
    Math.max(
      config.daft.requestDelayMs,
      DAFT_429_BACKOFF_MS,
      error.retryAfterMs ??
        config.daft.requestDelayMs * 2 ** (attempt + 1),
    ),
  );

interface BrowserSession {
  readonly browser: Browser;
  readonly context: BrowserContext;
  closeTimer?: ReturnType<typeof setTimeout>;
}

let browserSession: BrowserSession | undefined;

export const createDaftRequestGate = (
  now: () => number = () => Date.now(),
  sleep: (milliseconds: number) =>
    Promise<void> = (milliseconds) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }),
): ((minimumDelayMs: number) => Promise<void>) => {
  let lastRequestAt: number | undefined;
  return async (minimumDelayMs) => {
    if (lastRequestAt !== undefined) {
      const elapsedMs = now() - lastRequestAt;
      const waitMs = Math.max(0, minimumDelayMs - elapsedMs);
      if (waitMs > 0) await sleep(waitMs);
    }
    lastRequestAt = now();
  };
};

const daftRequestGate = createDaftRequestGate();
const ROBOTS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

interface RobotsCache {
  readonly origin: string;
  readonly fetchedAt: number;
  readonly text: string;
}

let robotsCache: RobotsCache | undefined;

const loadRobotsText = async (config: MonitorConfig): Promise<string> => {
  const origin = new URL(config.daft.baseUrl).origin;
  if (
    robotsCache &&
    robotsCache.origin === origin &&
    Date.now() - robotsCache.fetchedAt < ROBOTS_CACHE_MAX_AGE_MS
  ) {
    return robotsCache.text;
  }

  await daftRequestGate(config.daft.requestDelayMs);
  let session: BrowserSession | undefined;
  let page: Page | undefined;
  let succeeded = false;
  try {
    session = await getBrowserSession(config.browser);
    page = await session.context.newPage();
    page.setDefaultNavigationTimeout(config.browser.timeoutMs);
    const response = await page.goto(new URL("/robots.txt", origin).toString(), {
      waitUntil: "domcontentloaded",
      timeout: config.browser.timeoutMs,
    });
    const status = response?.status();
    const retryAfterMs =
      status === 429 && response !== null && response !== undefined
        ? parseRetryAfterMs(response.headers()["retry-after"])
        : undefined;
    if (status === 429) {
      throw new BrowserError("Daft robots.txt returned HTTP 429", {
        status,
        retryAfterMs,
      });
    }
    if (status !== 404 && status !== 200) {
      throw new Error(
        `HTTP ${status === undefined ? "no response" : status}`,
      );
    }
    const text =
      status === 404
        ? ""
        : ((await page.locator("body").textContent()) ?? "").slice(
            0,
            1_000_000,
          );
    robotsCache = { origin, fetchedAt: Date.now(), text };
    succeeded = true;
    return text;
  } catch (cause) {
    if (cause instanceof BrowserError) throw cause;
    const detail = cause instanceof Error ? `: ${cause.message}` : `: ${String(cause)}`;
    throw new BrowserError(`Could not fetch Daft robots.txt${detail}`, { cause });
  } finally {
    try {
      await page?.close();
    } catch {
      // Closing a failed robots page should not mask the original error.
    }
    if (session) {
      if (succeeded) scheduleBrowserClose(session);
      else await closeBrowserSession(session);
    }
  }
};

const ensureDaftRobotsAllowed = async (
  config: MonitorConfig,
  url: string,
): Promise<void> => {
  const robotsText = await loadRobotsText(config);
  if (
    !isRobotsAllowed(
      robotsText,
      url,
      resolveBrowserUserAgent(config.browser),
    )
  ) {
    throw new BrowserError(`Daft robots.txt disallows ${url}`);
  }
};


const closeBrowserSession = async (session: BrowserSession): Promise<void> => {
  if (browserSession !== session) return;
  browserSession = undefined;
  clearTimeout(session.closeTimer);
  try {
    await session.browser.close();
  } catch {
    // The browser may already have disconnected.
  }
};

const scheduleBrowserClose = (session: BrowserSession): void => {
  if (browserSession !== session) return;
  clearTimeout(session.closeTimer);
  session.closeTimer = setTimeout(() => {
    void closeBrowserSession(session);
  }, BROWSER_IDLE_CLOSE_MS);
  session.closeTimer.unref();
};

const connectBrowser = async (
  config: MonitorConfig["browser"],
): Promise<Browser> => {
  const strategy = resolveBrowserStrategy(config);
  if (strategy === "external") {
    if (!config.externalEndpoint) {
      throw new BrowserError(
        "An external Playwright endpoint is required for external browser mode",
      );
    }
    return chromium.connectOverCDP(config.externalEndpoint, {
      timeout: config.timeoutMs,
    });
  }

  const args = ["--disable-dev-shm-usage"];
  return chromium.launch({
    headless: true,
    timeout: config.timeoutMs,
    args,
  });
};

const getBrowserSession = async (
  config: MonitorConfig["browser"],
): Promise<BrowserSession> => {
  if (browserSession) {
    clearTimeout(browserSession.closeTimer);
    return browserSession;
  }

  const browser = await connectBrowser(config);
  try {
    const context =
      browser.contexts()[0] ??
      (await browser.newContext({
        userAgent: resolveBrowserUserAgent(config),
      }));
    browserSession = { browser, context };
    return browserSession;
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
};

const fetchDaftPayloadOnce = async (
  config: MonitorConfig,
  url: string,
): Promise<unknown> => {
  let session: BrowserSession | undefined;
  let page: Page | undefined;
  let succeeded = false;
  try {
    await ensureDaftRobotsAllowed(config, url);
    await daftRequestGate(config.daft.requestDelayMs);
    session = await getBrowserSession(config.browser);
    page = await session.context.newPage();
    page.setDefaultNavigationTimeout(config.browser.timeoutMs);
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.browser.timeoutMs,
    });
    const status = response?.status();
    const retryAfterMs =
      status === 429 && response !== null && response !== undefined
        ? parseRetryAfterMs(response.headers()["retry-after"])
        : undefined;
    assertDaftHttpStatus(status, retryAfterMs);
    const nextData = await page
      .locator("#__NEXT_DATA__")
      .textContent({ timeout: config.browser.timeoutMs });
    if (!nextData) {
      throw new BrowserError("Daft page returned empty __NEXT_DATA__", {
        cause: new Error(url),
      });
    }
    try {
      succeeded = true;
      return JSON.parse(nextData) as unknown;
    } catch (error) {
      throw new BrowserError("Daft __NEXT_DATA__ was not valid JSON", {
        cause: error,
      });
    }
  } finally {
    try {
      await page?.close();
    } catch {
      // Closing a failed page should not mask the original error.
    }
    if (session) {
      if (succeeded) scheduleBrowserClose(session);
      else await closeBrowserSession(session);
    }
  }
};

const fetchDaftPayloadWithRetry = async (
  config: MonitorConfig,
  url: string,
): Promise<unknown> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchDaftPayloadOnce(config, url);
    } catch (cause) {
      if (
        !(cause instanceof BrowserError) ||
        cause.status !== 429 ||
        attempt >= MAX_DAFT_HTTP_RETRIES
      ) {
        throw cause;
      }
      await sleep(retryDelayMs(config, cause, attempt));
    }
  }
};

export const fetchDaftPayload = (
  config: MonitorConfig,
  url: string,
): Effect.Effect<unknown, BrowserError> =>
  Effect.tryPromise({
    try: () => fetchDaftPayloadWithRetry(config, url),
    catch: (cause) =>
      cause instanceof BrowserError
        ? cause
        : new BrowserError(`Could not fetch Daft page: ${url}`, {
            cause,
          }),
  });
