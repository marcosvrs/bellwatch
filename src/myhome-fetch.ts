import { isRobotsAllowed } from "./daft/robots.js";

const ROBOTS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

interface RobotsCacheEntry {
  readonly fetchedAt: number;
  readonly text: string;
}

export interface MyHomePageFetcherOptions {
  readonly baseUrl: string;
  readonly userAgent: string;
  readonly minimumDelayMs: number;
  readonly timeoutMs: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export class MyHomeFetchError extends Error {
  readonly _tag = "MyHomeFetchError";
  readonly status: number | undefined;

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "MyHomeFetchError";
    this.status = status;
  }
}

export const createMyHomePageFetcher = (
  options: MyHomePageFetcherOptions,
): ((url: string) => Promise<string>) => {
  const baseUrl = new URL(options.baseUrl);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (async (milliseconds: number) => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, milliseconds);
    return promise;
  });
  let robotsCache: RobotsCacheEntry | undefined;
  let lastRequestAt: number | undefined;

  const request = async (url: string): Promise<Response> => {
    if (lastRequestAt !== undefined) {
      const elapsed = now() - lastRequestAt;
      const delay = Math.max(0, options.minimumDelayMs - elapsed);
      if (delay > 0) {await sleep(delay);}
    }
    lastRequestAt = now();
    try {
      return await fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": options.userAgent,
        },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (cause) {
      throw new MyHomeFetchError("MyHome request failed", undefined, { cause });
    }
  };

  const loadRobots = async (): Promise<string> => {
    if (robotsCache !== undefined && now() - robotsCache.fetchedAt < ROBOTS_CACHE_MAX_AGE_MS) {
      return robotsCache.text;
    }

    const response = await request(new URL("/robots.txt", baseUrl.origin).toString());
    if (response.status === 404) {
      robotsCache = { fetchedAt: now(), text: "" };
      return "";
    }
    if (!response.ok) {
      throw new MyHomeFetchError(
        `MyHome robots.txt returned HTTP ${response.status}`,
        response.status,
      );
    }
    const text = await response.text();
    robotsCache = { fetchedAt: now(), text };
    return text;
  };

  return async (targetUrl: string): Promise<string> => {
    const target = new URL(targetUrl);
    if (target.origin !== baseUrl.origin) {
      throw new MyHomeFetchError("MyHome page URL must use the configured origin");
    }
    const robotsText = await loadRobots();
    if (!isRobotsAllowed(robotsText, target.toString(), options.userAgent)) {
      throw new MyHomeFetchError(
        `MyHome robots.txt disallows ${target.pathname}${target.search}`,
      );
    }

    const response = await request(target.toString());
    if (!response.ok) {
      throw new MyHomeFetchError(
        `MyHome page returned HTTP ${response.status}`,
        response.status,
      );
    }
    const contentType = response.headers.get("content-type");
    if (
      contentType !== null &&
      !/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(contentType)
    ) {
      throw new MyHomeFetchError("MyHome page did not return HTML");
    }
    return response.text();
  };
};
