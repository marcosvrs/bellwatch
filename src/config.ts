import * as Cron from "effect/Cron";
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
import {
  SHPS_FILTER_MODES,
  type ShpsConfig,
  type ShpsFilterMode,
} from "./daft/shps.js";

export class ConfigurationError extends Error {
  readonly _tag = "ConfigurationError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigurationError";
  }
}


export type NotificationBackend = "shoutrrr" | "hermes";

export const DEFAULT_POLL_CRON = "0 */8 * * *";

const BROWSER_TIMEOUT_DEFAULT_MS = 120_000;
const SHOUTRRR_TIMEOUT_DEFAULT_MS = 15_000;
const HERMES_TIMEOUT_DEFAULT_MS = 20_000;
function resolveRuntimeTimezone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export const detectRuntimeTimezone = (
  resolve: () => string = resolveRuntimeTimezone,
): string => {
  try {
    const timezone = resolve();
    return timezone && timezone !== "Etc/Unknown" ? timezone : "UTC";
  } catch {
    return "UTC";
  }
};

export const DEFAULT_TIMEZONE = detectRuntimeTimezone();

export interface ShoutrrrConfig {
  readonly url: string;
  readonly binary: string;
  readonly titlePrefix: string;
  readonly timeoutMs: number;
}

export interface HermesConfig {
  readonly url: string;
  readonly secret: string;
  readonly chatId: string;
  readonly timeoutMs: number;
}

export interface MonitorConfig {
  readonly daft: {
    readonly baseUrl: string;
    readonly sectionPath: string;
    readonly locations: readonly string[];
    readonly filters: DaftFilters;
    readonly maxPages?: number;
    readonly requestDelayMs: number;
  };
  readonly shps: ShpsConfig;
  readonly notificationBackends: readonly NotificationBackend[];
  readonly browser: {
    readonly externalEndpoint?: string;
    readonly timeoutMs: number;
    readonly userAgent?: string;
  };
  readonly shoutrrr: ShoutrrrConfig;
  readonly hermes?: HermesConfig;
  readonly state: {
    readonly file: string;
    readonly databaseUrl?: string;
    readonly heartbeatFile: string;
  };
  readonly polling: {
    readonly cron: string;
    readonly timezone: string;
    readonly notifyExistingOnFirstRun: boolean;
  };
}

const trimmed = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name]?.trim();
  return value === "" ? undefined : value;
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

const choice = <T extends string>(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: T,
  allowed: readonly T[],
): T => {
  const raw = trimmed(env, name);
  const value = raw === undefined ? defaultValue : raw;
  const converted = String(value) as T;
  if (!allowed.includes(converted)) {
    throw new ConfigurationError(
      `${name} must be one of: ${allowed.join(", ")}`,
    );
  }
  return converted;
};

const optionalChoice = <T extends string | number>(
  env: NodeJS.ProcessEnv,
  name: string,
  allowed: readonly T[],
): T | undefined => {
  const raw = trimmed(env, name);
  if (raw === undefined) return undefined;
  const converted =
    typeof allowed[0] === "number" ? Number(raw) : String(raw);
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
  const values = list(env, "DAFT_PROPERTY_TYPES");
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

const httpUrl = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = trimmed(env, name)!;
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
  return value.replace(/\/+$/, "");
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

const parsePollingSchedule = (
  env: NodeJS.ProcessEnv,
): { readonly cron: string; readonly timezone: string } => {
  const timezone = trimmed(env, "TZ") ?? DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new ConfigurationError("TZ must be a valid IANA time zone");
  }

  const cron = trimmed(env, "POLL_CRON") ?? DEFAULT_POLL_CRON;
  try {
    Cron.parseUnsafe(cron, timezone);
  } catch {
    throw new ConfigurationError(
      "POLL_CRON must be a valid 5- or 6-field crontab expression",
    );
  }
  return { cron, timezone };
};

const validateRange = (
  name: string,
  min: number | undefined,
  max: number | undefined,
): void => {
  if ((min as number) > (max as number)) {
    throw new ConfigurationError(`${name} minimum cannot exceed maximum`);
  }
};

const parseLocations = (env: NodeJS.ProcessEnv): readonly string[] => {
  const value = trimmed(env, "DAFT_LOCATION");
  if (value === undefined) return [];
  const locations = unique(
    value
      .split(",")
      .map((location) => location.trim())
      .filter(Boolean)
      .map((location) => validatePath("DAFT_LOCATION", location)),
  );
  if (locations.length === 0) {
    throw new ConfigurationError(
      "DAFT_LOCATION must contain at least one location",
    );
  }
  return locations;
};

const parseDaftBaseUrl = (env: NodeJS.ProcessEnv): string => {
  const value = trimmed(env, "DAFT_BASE_URL") ?? "https://www.daft.ie";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError(
      "DAFT_BASE_URL must be an HTTP(S) origin without credentials, query, or fragment",
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ConfigurationError(
      "DAFT_BASE_URL must be an HTTP(S) origin without credentials, query, or fragment",
    );
  }
  return url.origin;
};

export const parseEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
): MonitorConfig => {
  const baseUrl = parseDaftBaseUrl(env);
  const shoutrrrUrl = trimmed(env, "SHOUTRRR_URL");
  const hermesWebhookUrl = trimmed(env, "HERMES_WEBHOOK_URL");
  const hermesWebhookSecret = trimmed(env, "HERMES_WEBHOOK_SECRET");
  const hermesChatId = trimmed(env, "HERMES_CHAT_ID");
  const hermesValues = [
    hermesWebhookUrl,
    hermesWebhookSecret,
    hermesChatId,
  ];
  const hermesConfigured = hermesValues.some(
    (value) => value !== undefined,
  );
  if (
    hermesConfigured &&
    hermesValues.some((value) => value === undefined)
  ) {
    throw new ConfigurationError(
      "HERMES_WEBHOOK_URL, HERMES_WEBHOOK_SECRET, and HERMES_CHAT_ID must be set together",
    );
  }
  const notificationBackends: NotificationBackend[] = [];
  if (shoutrrrUrl !== undefined) notificationBackends.push("shoutrrr");
  if (hermesConfigured) notificationBackends.push("hermes");
  if (notificationBackends.length === 0) {
    throw new ConfigurationError(
      "At least one notification backend must be configured: SHOUTRRR_URL or all Hermes variables",
    );
  }
  const externalEndpoint = websocketUrl(env, "PLAYWRIGHT_WS_ENDPOINT");

  const priceMinEur = optionalInteger(env, "DAFT_PRICE_MIN_EUR", 0, 100_000_000);
  const priceMaxEur = optionalInteger(env, "DAFT_PRICE_MAX_EUR", 0, 100_000_000);
  const bedsMin = optionalInteger(env, "DAFT_BEDS_MIN", 0, 15);
  const bedsMax = optionalInteger(env, "DAFT_BEDS_MAX", 0, 15);
  const bathsMin = optionalInteger(env, "DAFT_BATHS_MIN", 1, 5);
  const bathsMax = optionalInteger(env, "DAFT_BATHS_MAX", 1, 5);
  validateRange("DAFT_PRICE", priceMinEur, priceMaxEur);
  validateRange("DAFT_BEDS", bedsMin, bedsMax);
  validateRange("DAFT_BATHS", bathsMin, bathsMax);

  const locations = parseLocations(env);
  const shpsFilter = choice<ShpsFilterMode>(
    env,
    "SHPS_FILTER",
    "off",
    SHPS_FILTER_MODES,
  );
  const shps: ShpsConfig = {
    filter: shpsFilter,
  };
  const pollingSchedule = parsePollingSchedule(env);

  const filters: DaftFilters = {
    radiusKm: optionalChoice<DaftRadiusKm>(
      env,
      "DAFT_RADIUS_KM",
      DAFT_RADIUS_KM_OPTIONS,
    ),
    priceMinEur,
    priceMaxEur: priceMaxEur ?? 499_999,
    bedsMin,
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
    addedInLastDays: optionalChoice<DaftAddedInLastDays>(
      env,
      "DAFT_ADDED_IN_LAST_DAYS",
      DAFT_ADDED_IN_LAST_DAYS,
    ),
    openViewingsFrom: validateDate(env, "DAFT_OPEN_VIEWINGS_FROM"),
    sort: optionalChoice<DaftSort>(env, "DAFT_SORT", DAFT_SORTS),
  };

  return {
    notificationBackends,
    daft: {
      baseUrl,
      sectionPath: validatePath(
        "DAFT_SECTION_PATH",
        trimmed(env, "DAFT_SECTION_PATH") ?? "new-homes-for-sale",
      ),
      locations,
      filters,
      maxPages: optionalInteger(env, "DAFT_MAX_PAGES", 1, 20),
      requestDelayMs: integer(
        env,
        "DAFT_REQUEST_DELAY_MS",
        1_000,
        1_000,
        60_000,
      ),
    },
    shps,
    browser: {
      externalEndpoint,
      timeoutMs: BROWSER_TIMEOUT_DEFAULT_MS,
      userAgent: trimmed(env, "BROWSER_USER_AGENT"),
    },
    shoutrrr: {
      url: shoutrrrUrl ?? "",
      binary: "shoutrrr",
      titlePrefix: "Bellwatch new home",
      timeoutMs: SHOUTRRR_TIMEOUT_DEFAULT_MS,
    },
    hermes: hermesConfigured
      ? {
          url: httpUrl(env, "HERMES_WEBHOOK_URL"),
          secret: hermesWebhookSecret!,
          chatId: hermesChatId!,
          timeoutMs: HERMES_TIMEOUT_DEFAULT_MS,
        }
      : undefined,
    state: {
      file: "/data/state.sqlite",
      databaseUrl: databaseUrl(env),
      heartbeatFile: "/data/heartbeat",
    },
    polling: {
      cron: pollingSchedule.cron,
      timezone: pollingSchedule.timezone,
      notifyExistingOnFirstRun: boolean(
        env,
        "NOTIFY_EXISTING_ON_FIRST_RUN",
        false,
      ),
    },
  };
};
