import * as Effect from "effect/Effect";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import type { MonitorConfig } from "./config.js";

export class BrowserError extends Error {
  readonly _tag = "BrowserError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BrowserError";
  }
}

export type BrowserStrategy = "external" | "local";

export const resolveBrowserStrategy = (
  browser: MonitorConfig["browser"],
): BrowserStrategy =>
  browser.mode === "external" ||
  (browser.mode === "auto" && browser.externalEndpoint)
    ? "external"
    : "local";

const BROWSER_IDLE_CLOSE_MS = 30_000;

interface BrowserSession {
  readonly browser: Browser;
  readonly context: BrowserContext;
  closeTimer?: ReturnType<typeof setTimeout>;
}

let browserSession: BrowserSession | undefined;

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
  if (config.noSandbox) args.push("--no-sandbox");
  return chromium.launch({
    executablePath: config.chromiumExecutablePath,
    headless: config.headless,
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
      (await browser.newContext(
        config.userAgent ? { userAgent: config.userAgent } : undefined,
      ));
    browserSession = { browser, context };
    return browserSession;
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
};

export const fetchDaftPayload = (
  config: MonitorConfig,
  url: string,
): Effect.Effect<unknown, BrowserError> =>
  Effect.tryPromise({
    try: async () => {
      let session: BrowserSession | undefined;
      let page: Page | undefined;
      let succeeded = false;
      try {
        session = await getBrowserSession(config.browser);
        page = await session.context.newPage();
        page.setDefaultNavigationTimeout(config.browser.timeoutMs);
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: config.browser.timeoutMs,
        });
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
    },
    catch: (cause) =>
      cause instanceof BrowserError
        ? cause
        : new BrowserError(`Could not fetch Daft page: ${url}`, {
            cause,
          }),
  });
