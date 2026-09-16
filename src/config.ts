import {
  DAFT_ADDED_IN_LAST_DAYS,
  DAFT_AVAILABILITIES,
  DAFT_MEDIA_TYPES,
  DAFT_PROPERTY_TYPES,
  DAFT_RADIUS_KM_OPTIONS,
  DAFT_SORTS,
  type DaftAddedInLastDays,
  type DaftAvailability,
  type DaftFilters,
  type DaftMediaType,
  type DaftPropertyType,
  type DaftRadiusKm,
  type DaftSort,
} from "./daft/filters.js";

export class ConfigurationError extends Error {
  readonly _tag = "ConfigurationError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigurationError";
  }
}

export type BrowserMode = "auto" | "external" | "local";

export interface MonitorConfig {
  readonly daft: {
    readonly baseUrl: string;
    readonly sectionPath: string;
    readonly filters: DaftFilters;
    readonly maxPages: number;
  };
  readonly browser: {
    readonly mode: BrowserMode;
    readonly externalEndpoint?: string;
    readonly chromiumExecutablePath?: string;
    readonly headless: boolean;
    readonly noSandbox: boolean;
    readonly timeoutMs: number;
    readonly userAgent?: string;
  };
  readonly ntfy: {
    readonly url: string;
    readonly token?: string;
    readonly titlePrefix: string;
    readonly priority: string;
    readonly tags: readonly string[];
    readonly timeoutMs: number;
  };
  readonly state: {
    readonly file: string;
    readonly databaseUrl?: string;
    readonly heartbeatFile: string;
  };
  readonly redis?: {
    readonly url: string;
    readonly lockKey: string;
    readonly lockTtlMs: number;
  };
  readonly polling: {
    readonly intervalSeconds: number;
    readonly notifyExistingOnFirstRun: boolean;
  };
}

const trimmed = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name]?.trim();
  return value === "" ? undefined : value;
};

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = trimmed(env, name);
  if (!value) throw new ConfigurationError(`${name} is required`);
  return value;
};

const integer = (
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
  min: number,
  max: number,
): number => {
  const raw = trimmed(env, name);
  if (raw === undefined) return defaultValue;
  if (!/^-?\d+$/.test(raw)) {
    throw new ConfigurationError(`${name} must be an integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigurationError(`${name} must be between ${min} and ${max}`);
  }
  return value;
};

const optionalInteger = (
  env: NodeJS.ProcessEnv,
  name: string,
  min: number,
  max: number,
): number | undefined => {
  const raw = trimmed(env, name);
  if (raw === undefined) return undefined;
  return integer(env, name, 0, min, max);
};

const choice = <T extends string | number>(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: T,
  allowed: readonly T[],
): T => {
  const raw = trimmed(env, name);
  const value = raw === undefined ? defaultValue : raw;
  const converted =
    typeof defaultValue === "number" ? Number(value) : String(value);
  if (!allowed.includes(converted as T)) {
    throw new ConfigurationError(
      `${name} must be one of: ${allowed.join(", ")}`,
    );
  }
  return converted as T;
};

const boolean = (
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: boolean,
): boolean => {
  const raw = trimmed(env, name);
  if (raw === undefined) return defaultValue;
  switch (raw.toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new ConfigurationError(`${name} must be a boolean`);
  }
};

const list = (env: NodeJS.ProcessEnv, name: string): string[] =>
  (trimmed(env, name) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const parsePropertyTypes = (env: NodeJS.ProcessEnv): DaftPropertyType[] => {
  const values =
    trimmed(env, "DAFT_PROPERTY_TYPES") === undefined
      ? ["houses"]
      : list(env, "DAFT_PROPERTY_TYPES");
  if (values.length === 0) return [];
  if (values.includes("any")) {
    if (values.length > 1) {
      throw new ConfigurationError(
        "DAFT_PROPERTY_TYPES cannot combine any with specific values",
      );
    }
    return [];
  }
  const invalid = values.filter(
    (value): value is string =>
      !(DAFT_PROPERTY_TYPES as readonly string[]).includes(value),
  );
  if (invalid.length > 0) {
    throw new ConfigurationError(
      `DAFT_PROPERTY_TYPES contains unsupported values: ${invalid.join(", ")}`,
    );
  }
  return unique(values) as DaftPropertyType[];
};

const parseMediaTypes = (env: NodeJS.ProcessEnv): DaftMediaType[] => {
  const values = list(env, "DAFT_MEDIA_TYPES");
  if (values.length === 0) return [];
  if (values.includes("any")) {
    if (values.length > 1) {
      throw new ConfigurationError(
        "DAFT_MEDIA_TYPES cannot combine any with specific values",
      );
    }
    return [];
  }
  const invalid = values.filter(
    (value): value is string =>
      !(DAFT_MEDIA_TYPES as readonly string[]).includes(value),
  );
  if (invalid.length > 0) {
    throw new ConfigurationError(
      `DAFT_MEDIA_TYPES contains unsupported values: ${invalid.join(", ")}`,
    );
  }
  return unique(values) as DaftMediaType[];
};

const httpUrl = (env: NodeJS.ProcessEnv, name: string, requiredValue: boolean) => {
  const value = requiredValue ? required(env, name) : trimmed(env, name);
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError(`${name} must be a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigurationError(`${name} must use http or https`);
  }
  return url.toString().replace(/\/$/, "");
};

const websocketUrl = (
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined => {
  const value = trimmed(env, name);
  if (!value) return undefined;
  if (!/^wss?:\/\//.test(value)) {
    throw new ConfigurationError(`${name} must use ws or wss`);
  }
  return value;
};

const databaseUrl = (env: NodeJS.ProcessEnv): string | undefined => {
  const value = trimmed(env, "DATABASE_URL");
  if (!value) return undefined;
  if (!/^postgres(?:ql)?:\/\//.test(value)) {
    throw new ConfigurationError(
      "DATABASE_URL must use postgres:// or postgresql://",
    );
  }
  return value;
};

const validatePath = (name: string, value: string): string => {
  if (
    value.startsWith("/") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes(" ")
  ) {
    throw new ConfigurationError(
      `${name} must be a Daft URL path without spaces, query, or fragment`,
    );
  }
  return value.replace(/^\/+|\/+$/g, "");
};

const validateDate = (
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined => {
  const value = trimmed(env, name);
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConfigurationError(`${name} must use YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ConfigurationError(`${name} must be a real calendar date`);
  }
  return value;
};

const validateRange = (
  name: string,
  min: number | undefined,
  max: number | undefined,
) => {
  if (min !== undefined && max !== undefined && min > max) {
    throw new ConfigurationError(`${name} minimum cannot exceed maximum`);
  }
};

export const parseEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
): MonitorConfig => {
  const baseUrl = httpUrl(env, "DAFT_BASE_URL", false) ?? "https://www.daft.ie";
  const ntfyUrl = httpUrl(env, "NTFY_URL", true)!;
  const browserMode = choice<BrowserMode>(env, "BROWSER_MODE", "auto", [
    "auto",
    "external",
    "local",
  ]);
  const externalEndpoint = websocketUrl(env, "PLAYWRIGHT_WS_ENDPOINT");
  if (browserMode === "external" && !externalEndpoint) {
    throw new ConfigurationError(
      "PLAYWRIGHT_WS_ENDPOINT is required when BROWSER_MODE=external",
    );
  }

  const priceMinEur = optionalInteger(env, "DAFT_PRICE_MIN_EUR", 0, 100_000_000);
  const priceMaxEur = optionalInteger(env, "DAFT_PRICE_MAX_EUR", 0, 100_000_000);
  const bedsMin = optionalInteger(env, "DAFT_BEDS_MIN", 0, 15);
  const bedsMax = optionalInteger(env, "DAFT_BEDS_MAX", 0, 15);
  const bathsMin = optionalInteger(env, "DAFT_BATHS_MIN", 1, 5);
  const bathsMax = optionalInteger(env, "DAFT_BATHS_MAX", 1, 5);
  validateRange("DAFT_PRICE", priceMinEur, priceMaxEur);
  validateRange("DAFT_BEDS", bedsMin, bedsMax);
  validateRange("DAFT_BATHS", bathsMin, bathsMax);

  const filters: DaftFilters = {
    locationPath: validatePath(
      "DAFT_LOCATION_PATH",
      trimmed(env, "DAFT_LOCATION_PATH") ?? "dublin-city-centre-dublin",
    ),
    radiusKm: choice<DaftRadiusKm>(env, "DAFT_RADIUS_KM", 20, DAFT_RADIUS_KM_OPTIONS),
    priceMinEur,
    priceMaxEur: priceMaxEur ?? 499_999,
    bedsMin: bedsMin ?? 3,
    bedsMax,
    propertyTypes: parsePropertyTypes(env),
    bathsMin,
    bathsMax,
    mediaTypes: parseMediaTypes(env),
    keyword: (() => {
      const value = trimmed(env, "DAFT_KEYWORD");
      if (value && value.length > 50) {
        throw new ConfigurationError("DAFT_KEYWORD cannot exceed 50 characters");
      }
      return value;
    })(),
    availability: choice<DaftAvailability>(
      env,
      "DAFT_AVAILABILITY",
      "published",
      DAFT_AVAILABILITIES,
    ),
    addedInLastDays: choice<DaftAddedInLastDays>(
      env,
      "DAFT_ADDED_IN_LAST_DAYS",
      0,
      DAFT_ADDED_IN_LAST_DAYS,
    ),
    openViewingsFrom: validateDate(env, "DAFT_OPEN_VIEWINGS_FROM"),
    sort: choice<DaftSort>(env, "DAFT_SORT", "priceAsc", DAFT_SORTS),
  };

  const redisUrl = trimmed(env, "REDIS_URL");
  if (redisUrl && !/^rediss?:\/\//.test(redisUrl)) {
    throw new ConfigurationError("REDIS_URL must use redis:// or rediss://");
  }

  return {
    daft: {
      baseUrl,
      sectionPath: validatePath(
        "DAFT_SECTION_PATH",
        trimmed(env, "DAFT_SECTION_PATH") ?? "new-homes-for-sale",
      ),
      filters,
      maxPages: integer(env, "DAFT_MAX_PAGES", 1, 1, 20),
    },
    browser: {
      mode: browserMode,
      externalEndpoint,
      chromiumExecutablePath: trimmed(env, "CHROMIUM_EXECUTABLE_PATH"),
      headless: boolean(env, "CHROMIUM_HEADLESS", true),
      noSandbox: boolean(env, "CHROMIUM_NO_SANDBOX", false),
      timeoutMs: integer(env, "BROWSER_TIMEOUT_MS", 60_000, 1_000, 300_000),
      userAgent: trimmed(env, "BROWSER_USER_AGENT"),
    },
    ntfy: {
      url: ntfyUrl,
      token: trimmed(env, "NTFY_TOKEN"),
      titlePrefix: trimmed(env, "NTFY_TITLE_PREFIX") ?? "Daft new home",
      priority: trimmed(env, "NTFY_PRIORITY") ?? "default",
      tags: unique(
        (trimmed(env, "NTFY_TAGS") ?? "house,new-home")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
      timeoutMs: integer(env, "NTFY_TIMEOUT_MS", 15_000, 1_000, 120_000),
    },
    state: {
      file: trimmed(env, "STATE_FILE") ?? "/data/state.sqlite",
      databaseUrl: databaseUrl(env),
      heartbeatFile: trimmed(env, "HEARTBEAT_FILE") ?? "/data/heartbeat",
    },
    redis: redisUrl
      ? {
          url: redisUrl,
          lockKey:
            trimmed(env, "REDIS_LOCK_KEY") ?? "daft-house-search:monitor",
          lockTtlMs: integer(env, "REDIS_LOCK_TTL_SECONDS", 300, 10, 86_400) * 1_000,
        }
      : undefined,
    polling: {
      intervalSeconds: integer(env, "POLL_INTERVAL_SECONDS", 900, 1, 86_400),
      notifyExistingOnFirstRun: boolean(
        env,
        "NOTIFY_EXISTING_ON_FIRST_RUN",
        false,
      ),
    },
  };
};
