import assert from "node:assert/strict";
import test from "node:test";
import {
  DAFT_ADDED_IN_LAST_DAYS,
  DAFT_FILTER_ENV_VARS,
  DAFT_MEDIA_TYPES,
  DAFT_PROPERTY_TYPES,
  addedInLastDateValue,
  type DaftFilters,
} from "../src/daft/filters.js";
import { buildDaftSearchUrls, buildDaftSearchUrl } from "../src/daft/url.js";
import {
  ConfigurationError,
  parseEnvironment,
} from "../src/config.js";

const baseFilters: DaftFilters = {
  radiusKm: 20,
  priceMinEur: 300_000,
  priceMaxEur: 499_999,
  bedsMin: 3,
  bedsMax: 6,
  propertyTypes: ["houses"],
  bathsMin: 2,
  bathsMax: 4,
  mediaTypes: ["video"],
  keyword: "garage",
  availability: "sale-agreed",
  addedInLastDays: 7,
  openViewingsFrom: "2026-08-01",
  sort: "priceDesc",
};

const searchUrl = (
  filters: DaftFilters = baseFilters,
  page = 1,
  locationPath = "dublin-city-centre-dublin",
) =>
  new URL(
    buildDaftSearchUrl(
      {
        baseUrl: "https://www.daft.ie",
        sectionPath: "new-homes-for-sale",
        locationPath,
        filters,
      },
      page,
    ),
  );

test("maps every Daft web filter to its URL parameter", () => {
  const url = searchUrl();
  assert.equal(
    url.pathname,
    "/new-homes-for-sale/dublin-city-centre-dublin/houses",
  );
  assert.equal(url.searchParams.get("radius"), "20000");
  assert.equal(url.searchParams.get("salePrice_from"), "300000");
  assert.equal(url.searchParams.get("salePrice_to"), "499999");
  assert.equal(url.searchParams.get("numBeds_from"), "3");
  assert.equal(url.searchParams.get("numBeds_to"), "6");
  assert.equal(url.searchParams.get("numBaths_from"), "2");
  assert.equal(url.searchParams.get("numBaths_to"), "4");
  assert.deepEqual(url.searchParams.getAll("mediaTypes"), ["video"]);
  assert.equal(url.searchParams.get("terms"), "garage");
  assert.equal(url.searchParams.get("adState"), "sale-agreed");
  assert.equal(url.searchParams.get("firstPublishDate_from"), "now-7d/d");
  assert.equal(url.searchParams.get("viewingTimes_from"), "2026-08-01");
  assert.equal(url.searchParams.get("sort"), "priceDesc");
  assert.equal(searchUrl(baseFilters, 2).searchParams.get("page"), "2");
});

test("maps multi-select property and media filters exactly like Daft", () => {
  const url = searchUrl({
    ...baseFilters,
    propertyTypes: ["houses", "apartments"],
    mediaTypes: ["video", "virtual-tour"],
  });
  assert.equal(url.pathname, "/new-homes-for-sale/dublin-city-centre-dublin");
  assert.deepEqual(url.searchParams.getAll("propertyType"), [
    "houses",
    "apartments",
  ]);
  assert.deepEqual(url.searchParams.getAll("mediaTypes"), [
    "video",
    "virtual-tour",
  ]);
});

test("covers every Daft property and media value", () => {
  for (const propertyType of DAFT_PROPERTY_TYPES) {
    const url = searchUrl({ ...baseFilters, propertyTypes: [propertyType] });
    assert.equal(url.pathname.endsWith(`/${propertyType}`), true);
  }
  const mediaUrl = searchUrl({
    ...baseFilters,
    mediaTypes: [...DAFT_MEDIA_TYPES],
  });
  assert.deepEqual(mediaUrl.searchParams.getAll("mediaTypes"), [
    ...DAFT_MEDIA_TYPES,
  ]);
});

test("maps available Added In Last choices", () => {
  assert.deepEqual(
    DAFT_ADDED_IN_LAST_DAYS.map(addedInLastDateValue),
    [undefined, "now-1d/d", "now-3d/d", "now-7d/d", "now-14d/d", "now-30d/d"],
  );
});

test("handles empty optional filters and rejects invalid page counts", () => {
  const filters: DaftFilters = {
    ...baseFilters,
    radiusKm: 0,
    priceMinEur: undefined,
    priceMaxEur: undefined,
    bedsMin: undefined,
    bedsMax: undefined,
    propertyTypes: [],
    bathsMin: undefined,
    bathsMax: undefined,
    mediaTypes: [],
    keyword: undefined,
    availability: "published",
    addedInLastDays: 0,
    openViewingsFrom: undefined,
  };
  const request = {
    baseUrl: "https://www.daft.ie",
    sectionPath: "new-homes-for-sale",
    locationPath: "dublin-city-centre-dublin",
    filters,
  };
  const url = new URL(buildDaftSearchUrl(request));
  assert.equal(url.pathname, "/new-homes-for-sale/dublin-city-centre-dublin");
  assert.deepEqual([...url.searchParams.keys()], ["sort"]);
  assert.deepEqual(buildDaftSearchUrls(request, 1), [buildDaftSearchUrl(request)]);
  assert.equal(
    buildDaftSearchUrls(request, 2)[1].endsWith("&page=2"),
    true,
  );
  assert.throws(() => buildDaftSearchUrl(request, 0), /positive integer/);
  assert.throws(() => buildDaftSearchUrl(request, 1.5), /positive integer/);
  assert.throws(() => buildDaftSearchUrls(request, 0), /positive integer/);
});

test("accepts Daft web filters from environment variables", () => {
  const config = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_LOCATION_PATH: " drogheda-louth, navan-meath, drogheda-louth ",
    DAFT_RADIUS_KM: "5",
    DAFT_PRICE_MIN_EUR: "300000",
    DAFT_PRICE_MAX_EUR: "499999",
    DAFT_BEDS_MIN: "3",
    DAFT_BEDS_MAX: "6",
    DAFT_PROPERTY_TYPES: "houses,apartments",
    DAFT_BATHS_MIN: "2",
    DAFT_BATHS_MAX: "4",
    DAFT_MEDIA_TYPES: "video,virtual-tour",
    DAFT_KEYWORD: "garage",
    DAFT_AVAILABILITY: "sale-agreed",
    DAFT_ADDED_IN_LAST_DAYS: "14",
    DAFT_OPEN_VIEWINGS_FROM: "2026-08-01",
    DAFT_SORT: "publishDateDesc",
  });
  assert.equal(DAFT_FILTER_ENV_VARS.length, 15);
  assert.deepEqual(config.daft.locationPaths, ["drogheda-louth", "navan-meath"]);
  assert.equal(config.daft.filters.radiusKm, 5);
  assert.deepEqual(config.daft.filters.propertyTypes, ["houses", "apartments"]);
  assert.deepEqual(config.daft.filters.mediaTypes, ["video", "virtual-tour"]);
  assert.equal(config.daft.filters.addedInLastDays, 14);
  assert.equal(config.daft.filters.openViewingsFrom, "2026-08-01");
  assert.equal(config.daft.filters.sort, "publishDateDesc");
});

test("rejects invalid or contradictory filter configuration", () => {
  assert.throws(
    () => parseEnvironment({ SHOUTRRR_URL: "ntfy://ntfy.sh/daft", DAFT_RADIUS_KM: "2" }),
    /DAFT_RADIUS_KM must be one of/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_PRICE_MIN_EUR: "500000",
        DAFT_PRICE_MAX_EUR: "400000",
      }),
    /DAFT_PRICE minimum cannot exceed maximum/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_OPEN_VIEWINGS_FROM: "2026-02-30",
      }),
    /DAFT_OPEN_VIEWINGS_FROM must be a real calendar date/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_PROPERTY_TYPES: "any,apartments",
      }),
    /DAFT_PROPERTY_TYPES cannot combine any/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_MEDIA_TYPES: "any,video",
      }),
    /DAFT_MEDIA_TYPES cannot combine any/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_LOCATION_PATH: ",",
      }),
    /DAFT_LOCATION_PATH must contain at least one location path/,
  );
});

test("parses optional resource settings and rejects malformed environment values", () => {
  const configured = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_BASE_URL: "https://www.daft.ie/",
    DAFT_SECTION_PATH: "new-homes-for-sale/",
    BROWSER_MODE: "external",
    PLAYWRIGHT_WS_ENDPOINT: "wss://browser.example/playwright",
    CHROMIUM_HEADLESS: "yes",
    CHROMIUM_NO_SANDBOX: "on",
    DATABASE_URL: "postgresql://user:password@db.example/daft",
    REDIS_URL: "rediss://redis.example",
    REDIS_LOCK_KEY: "test-lock",
    REDIS_LOCK_TTL_SECONDS: "60",
    SHOUTRRR_TITLE_PREFIX: "Custom title",
    SHOUTRRR_BINARY: "/opt/shoutrrr",
    SHOUTRRR_TIMEOUT_MS: "60000",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  assert.equal(configured.shoutrrr.url, "ntfy://ntfy.sh/daft");
  assert.equal(configured.shoutrrr.binary, "/opt/shoutrrr");
  assert.equal(configured.shoutrrr.titlePrefix, "Custom title");
  assert.equal(configured.shoutrrr.timeoutMs, 60_000);
  assert.equal(configured.browser.headless, true);
  assert.equal(configured.browser.noSandbox, true);
  assert.equal(
    configured.state.databaseUrl,
    "postgresql://user:password@db.example/daft",
  );
  assert.deepEqual(configured.redis, {
    url: "rediss://redis.example",
    lockKey: "test-lock",
    lockTtlMs: 60_000,
  });
  assert.equal(
    parseEnvironment({
      SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
      REDIS_URL: "redis://redis.example",
    }).redis?.lockKey,
    "bellwatch:monitor",
  );
  assert.equal(
    parseEnvironment({
      SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
      REDIS_URL: "redis://redis.example",
    }).redis?.lockTtlMs,
    300_000,
  );
  assert.equal(configured.polling.notifyExistingOnFirstRun, true);

  assert.throws(() => parseEnvironment({}), /SHOUTRRR_URL is required/);
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_LOCATION_PATH: "/dublin",
      }),
    /DAFT_LOCATION_PATH must be a Daft URL path/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_OPEN_VIEWINGS_FROM: "2026-02",
      }),
    /DAFT_OPEN_VIEWINGS_FROM must use YYYY-MM-DD/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_KEYWORD: "x".repeat(51),
      }),
    /DAFT_KEYWORD cannot exceed 50 characters/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DATABASE_URL: "mysql://db.example/daft",
      }),
    /DATABASE_URL must use postgres/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        REDIS_URL: "https://redis.example",
      }),
    /REDIS_URL must use redis/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        BROWSER_MODE: "external",
      }),
    /PLAYWRIGHT_WS_ENDPOINT is required/,
  );
  assert.deepEqual(
    parseEnvironment({
      SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
      DAFT_PROPERTY_TYPES: "any",
      DAFT_MEDIA_TYPES: "any",
    }).daft.filters,
    {
      radiusKm: 20,
      priceMinEur: undefined,
      priceMaxEur: 499_999,
      bedsMin: 3,
      bedsMax: undefined,
      propertyTypes: [],
      bathsMin: undefined,
      bathsMax: undefined,
      mediaTypes: [],
      keyword: undefined,
      availability: "published",
      addedInLastDays: 0,
      openViewingsFrom: undefined,
      sort: "priceAsc",
    },
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_PRICE_MIN_EUR: "three",
      }),
    /DAFT_PRICE_MIN_EUR must be an integer/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_BEDS_MIN: "-1",
      }),
    /DAFT_BEDS_MIN must be between/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_PROPERTY_TYPES: "caves",
      }),
    /DAFT_PROPERTY_TYPES contains unsupported values/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_MEDIA_TYPES: "photo",
      }),
    /DAFT_MEDIA_TYPES contains unsupported values/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_BASE_URL: "not a url",
      }),
    /DAFT_BASE_URL must be a valid URL/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_BASE_URL: "ftp://daft.example",
      }),
    /DAFT_BASE_URL must use http or https/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        PLAYWRIGHT_WS_ENDPOINT: "http://browser.example",
      }),
    /PLAYWRIGHT_WS_ENDPOINT must use ws or wss/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        CHROMIUM_HEADLESS: "sometimes",
      }),
    /CHROMIUM_HEADLESS must be a boolean/,
  );
});

test("covers trimming, defaults, and boundary validation", () => {
  const defaults = parseEnvironment({
    SHOUTRRR_URL: "  ntfy://ntfy.sh/daft/  ",
  });
  assert.equal(defaults.browser.headless, true);
  assert.equal(defaults.browser.noSandbox, false);
  assert.equal(defaults.shoutrrr.titlePrefix, "Bellwatch new home");
  assert.equal(defaults.shoutrrr.binary, "shoutrrr");
  assert.equal(defaults.state.file, "/data/state.sqlite");
  assert.equal(defaults.state.heartbeatFile, "/data/heartbeat");
  assert.equal(new ConfigurationError("bad").name, "ConfigurationError");
  assert.equal(new ConfigurationError("bad")._tag, "ConfigurationError");

  const trimmed = parseEnvironment({
    SHOUTRRR_URL: " ntfy://ntfy.sh/daft/ ",
    DAFT_LOCATION_PATH: " dublin-city-centre-dublin/ ",
    DAFT_SECTION_PATH: " new-homes-for-sale/ ",
    DAFT_KEYWORD: " garage ",
    SHOUTRRR_TITLE_PREFIX: " Custom ",
    SHOUTRRR_BINARY: " /usr/local/bin/shoutrrr ",
    SHOUTRRR_TIMEOUT_MS: "60000",
    STATE_FILE: " /tmp/state.sqlite ",
    HEARTBEAT_FILE: " /tmp/heartbeat ",
    BROWSER_USER_AGENT: " agent ",
  });
  assert.deepEqual(trimmed.daft.locationPaths, ["dublin-city-centre-dublin"]);
  assert.equal(trimmed.daft.sectionPath, "new-homes-for-sale");
  assert.equal(trimmed.daft.filters.keyword, "garage");
  assert.equal(trimmed.shoutrrr.titlePrefix, "Custom");
  assert.equal(trimmed.shoutrrr.binary, "/usr/local/bin/shoutrrr");
  assert.equal(trimmed.shoutrrr.timeoutMs, 60_000);
  assert.equal(trimmed.state.file, "/tmp/state.sqlite");
  assert.equal(trimmed.state.heartbeatFile, "/tmp/heartbeat");
  assert.equal(trimmed.browser.userAgent, "agent");

  const falseBooleans = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    CHROMIUM_HEADLESS: "off",
    CHROMIUM_NO_SANDBOX: "0",
    NOTIFY_EXISTING_ON_FIRST_RUN: "no",
  });
  assert.equal(falseBooleans.browser.headless, false);
  assert.equal(falseBooleans.browser.noSandbox, false);
  assert.equal(falseBooleans.polling.notifyExistingOnFirstRun, false);

  const equalRange = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_PRICE_MIN_EUR: "100",
    DAFT_PRICE_MAX_EUR: "100",
  });
  assert.equal(equalRange.daft.filters.priceMinEur, 100);
  assert.equal(equalRange.daft.filters.priceMaxEur, 100);
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_MAX_PAGES: "1x",
      }),
    /DAFT_MAX_PAGES must be an integer/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_MAX_PAGES: "x1",
      }),
    /DAFT_MAX_PAGES must be an integer/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_BEDS_MAX: "16",
      }),
    /DAFT_BEDS_MAX must be between/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_OPEN_VIEWINGS_FROM: "x2026-02-01",
      }),
    /DAFT_OPEN_VIEWINGS_FROM must use YYYY-MM-DD/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_OPEN_VIEWINGS_FROM: "2026-02-01x",
      }),
    /DAFT_OPEN_VIEWINGS_FROM must use YYYY-MM-DD/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        PLAYWRIGHT_WS_ENDPOINT: "xws://browser.example",
      }),
    /PLAYWRIGHT_WS_ENDPOINT must use ws or wss/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DATABASE_URL: "xpostgresql://db.example/daft",
      }),
    /DATABASE_URL must use postgres/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        REDIS_URL: "xredis://redis.example",
      }),
    /REDIS_URL must use redis/,
  );
});
