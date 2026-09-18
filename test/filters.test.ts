import * as Cron from "effect/Cron";
import assert from "node:assert/strict";
import test from "node:test";
import {
  DAFT_ADDED_IN_LAST_DAYS,
  DAFT_MEDIA_TYPES,
  DAFT_PROPERTY_TYPES,
  addedInLastDateValue,
  type DaftFilters,
} from "../src/daft/filters.js";
import { buildDaftSearchUrl } from "../src/daft/url.js";
import {
  ConfigurationError,
  DEFAULT_POLL_CRON,
  DEFAULT_TIMEZONE,
  detectRuntimeTimezone,
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
  locations: readonly string[] = ["dublin-city-centre-dublin"],
) =>
  new URL(
    buildDaftSearchUrl(
      {
        baseUrl: "https://www.daft.ie",
        sectionPath: "new-homes-for-sale",
        locations,
        filters,
      },
      page,
    ),
  );

test("maps every Daft web filter to its URL parameter", () => {
  const url = searchUrl();
  assert.equal(url.pathname, "/new-homes-for-sale/ireland/houses");
  assert.deepEqual(url.searchParams.getAll("location"), [
    "dublin-city-centre-dublin",
  ]);
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
  assert.equal(url.pathname, "/new-homes-for-sale/ireland");
  assert.deepEqual(url.searchParams.getAll("location"), [
    "dublin-city-centre-dublin",
  ]);
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
    radiusKm: undefined,
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
    addedInLastDays: undefined,
    openViewingsFrom: undefined,
    sort: undefined,
  };
  const request = {
    baseUrl: "https://www.daft.ie",
    sectionPath: "new-homes-for-sale",
    locations: [],
    filters,
  };
  const url = new URL(buildDaftSearchUrl(request));
  assert.equal(url.pathname, "/new-homes-for-sale/ireland");
  assert.deepEqual([...url.searchParams.keys()], []);
  assert.throws(() => buildDaftSearchUrl(request, 0), /positive integer/);
  assert.throws(() => buildDaftSearchUrl(request, 1.5), /positive integer/);
});

test("accepts Daft web filters from environment variables", () => {
  const config = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_LOCATION: "dublin-city,drogheda-and-surrounds-louth,navan-and-surrounds-meath",
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
  assert.deepEqual(config.daft.locations, [
    "dublin-city",
    "drogheda-and-surrounds-louth",
    "navan-and-surrounds-meath",
  ]);
  assert.equal(config.daft.filters.radiusKm, 5);
  assert.deepEqual(config.daft.filters.propertyTypes, ["houses", "apartments"]);
  assert.deepEqual(config.daft.filters.mediaTypes, ["video", "virtual-tour"]);
  assert.equal(config.daft.filters.addedInLastDays, 14);
  assert.equal(config.daft.filters.openViewingsFrom, "2026-08-01");
  assert.equal(config.daft.filters.sort, "publishDateDesc");
});

test("parses cron polling schedules in the configured timezone", () => {
  const defaults = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
  });
  assert.equal(defaults.polling.cron, DEFAULT_POLL_CRON);
  assert.equal(
    defaults.polling.timezone,
    new Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  const defaultSchedule = Cron.parseUnsafe(defaults.polling.cron, "UTC");
  assert.equal(
    Cron.next(defaultSchedule, "2026-01-01T00:01:00Z").toISOString(),
    "2026-01-01T08:00:00.000Z",
  );

  const configured = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    POLL_CRON: "0 8 * * *",
    TZ: "Europe/Dublin",
  });
  assert.equal(configured.polling.cron, "0 8 * * *");
  assert.equal(configured.polling.timezone, "Europe/Dublin");
  const configuredSchedule = Cron.parseUnsafe(
    configured.polling.cron,
    configured.polling.timezone,
  );
  assert.equal(
    Cron.next(configuredSchedule, "2026-07-01T06:30:00Z").toISOString(),
    "2026-07-01T07:00:00.000Z",
  );
});

test("rejects invalid cron schedules and timezones", () => {
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        POLL_CRON: "0 25 * * *",
      }),
    /POLL_CRON must be a valid 5- or 6-field crontab expression/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        TZ: "Not/AZone",
      }),
    /TZ must be a valid IANA time zone/,
  );
});

test("accepts exclusive and exclusion SHPS filter modes", () => {
  const only = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    SHPS_FILTER: "only",
  });
  assert.deepEqual(only.shps, {
    filter: "only",
  });

  const exclude = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    SHPS_FILTER: "exclude",
  });
  assert.deepEqual(exclude.shps, {
    filter: "exclude",
  });

  const off = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
  });
  assert.deepEqual(off.shps, {
    filter: "off",
  });
});

test("accepts Hermes notification settings", () => {
  const config = parseEnvironment({
    HERMES_WEBHOOK_URL: "http://hermes:8644/webhooks/ha-notify",
    HERMES_WEBHOOK_SECRET: "test-secret",
    HERMES_CHAT_ID: "test-whatsapp-group",
  });

  assert.deepEqual(config.notificationBackends, ["hermes"]);
  assert.deepEqual(config.hermes, {
    url: "http://hermes:8644/webhooks/ha-notify",
    secret: "test-secret",
    chatId: "test-whatsapp-group",
    timeoutMs: 20_000,
  });
  assert.equal(config.shoutrrr.url, "");
});

test("detects Shoutrrr and Hermes independently or together", () => {
  const hermes = {
    HERMES_WEBHOOK_URL: "http://hermes:8644/webhooks/ha-notify",
    HERMES_WEBHOOK_SECRET: "test-secret",
    HERMES_CHAT_ID: "test-whatsapp-group",
  };
  const shoutrrr = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
  });
  const hermesOnly = parseEnvironment(hermes);
  const both = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    ...hermes,
  });

  assert.deepEqual(shoutrrr.notificationBackends, ["shoutrrr"]);
  assert.deepEqual(hermesOnly.notificationBackends, ["hermes"]);
  assert.deepEqual(both.notificationBackends, ["shoutrrr", "hermes"]);
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
        DAFT_LOCATION: ",",
      }),
    /DAFT_LOCATION must contain at least one location/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        SHPS_FILTER: "invalid",
      }),
    /SHPS_FILTER must be one of/,
  );
});

test("parses optional resource settings and rejects malformed environment values", () => {
  const configured = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_BASE_URL: "http://fixture.example:8080/",
    DAFT_SECTION_PATH: "property-to-rent",
    DAFT_REQUEST_DELAY_MS: "2500",
    PLAYWRIGHT_WS_ENDPOINT: "wss://browser.example/playwright",
    DATABASE_URL: "postgresql://user:password@db.example/daft",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  assert.equal(configured.shoutrrr.url, "ntfy://ntfy.sh/daft");
  assert.equal(configured.daft.baseUrl, "http://fixture.example:8080");
  assert.equal(configured.daft.sectionPath, "property-to-rent");
  assert.equal(configured.daft.requestDelayMs, 2_500);
  assert.equal(
    configured.browser.externalEndpoint,
    "wss://browser.example/playwright",
  );
  assert.equal(
    configured.state.databaseUrl,
    "postgresql://user:password@db.example/daft",
  );
  assert.equal(configured.polling.notifyExistingOnFirstRun, true);

  assert.throws(
    () => parseEnvironment({}),
    /At least one notification backend must be configured/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        HERMES_WEBHOOK_URL: "http://hermes:8644/webhooks/ha-notify",
      }),
    /HERMES_WEBHOOK_URL, HERMES_WEBHOOK_SECRET, and HERMES_CHAT_ID must be set together/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_LOCATION: "/dublin",
      }),
    /DAFT_LOCATION must be a Daft URL path/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_BASE_URL: "https://www.daft.ie/search?test=1",
      }),
    /DAFT_BASE_URL must be an HTTP\(S\) origin/,
  );
  for (const baseUrl of [
    "ftp://www.daft.ie",
    "https://u@[::1]",
    "https://:pw@[::1]",
    "https://www.daft.ie#fragment",
    "not-a-url",
  ]) {
    assert.throws(
      () =>
        parseEnvironment({
          SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
          DAFT_BASE_URL: baseUrl,
        }),
      /DAFT_BASE_URL must be an HTTP\(S\) origin/,
    );
  }
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
  assert.deepEqual(
    parseEnvironment({
      SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
      DAFT_PROPERTY_TYPES: "any",
      DAFT_MEDIA_TYPES: "any",
    }).daft.filters,
    {
      radiusKm: undefined,
      priceMinEur: undefined,
      priceMaxEur: 499_999,
      bedsMin: undefined,
      bedsMax: undefined,
      propertyTypes: [],
      bathsMin: undefined,
      bathsMax: undefined,
      mediaTypes: [],
      keyword: undefined,
      availability: "published",
      addedInLastDays: undefined,
      openViewingsFrom: undefined,
      sort: undefined,
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
        HERMES_WEBHOOK_URL: "not a url",
        HERMES_WEBHOOK_SECRET: "test-secret",
        HERMES_CHAT_ID: "test-chat",
      }),
    /HERMES_WEBHOOK_URL must be a valid URL/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        HERMES_WEBHOOK_URL: "ftp://hermes.example",
        HERMES_WEBHOOK_SECRET: "test-secret",
        HERMES_CHAT_ID: "test-chat",
      }),
    /HERMES_WEBHOOK_URL must use http or https/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        PLAYWRIGHT_WS_ENDPOINT: "http://browser.example",
      }),
    /PLAYWRIGHT_WS_ENDPOINT must use ws or wss/,
  );
});

test("covers trimming, defaults, and boundary validation", () => {
  const defaults = parseEnvironment({
    SHOUTRRR_URL: "  ntfy://ntfy.sh/daft/  ",
  });
  assert.equal(defaults.shoutrrr.titlePrefix, "Bellwatch new home");
  assert.equal(defaults.shoutrrr.binary, "shoutrrr");
  assert.equal(defaults.state.file, "/data/state.sqlite");
  assert.equal(defaults.state.heartbeatFile, "/data/heartbeat");
  assert.deepEqual(defaults.shps, {
    filter: "off",
  });
  assert.deepEqual(defaults.daft.filters, {
    radiusKm: undefined,
    priceMinEur: undefined,
    priceMaxEur: 499_999,
    bedsMin: undefined,
    bedsMax: undefined,
    propertyTypes: [],
    bathsMin: undefined,
    bathsMax: undefined,
    mediaTypes: [],
    keyword: undefined,
    availability: "published",
    addedInLastDays: undefined,
    openViewingsFrom: undefined,
    sort: undefined,
  });
  assert.equal(defaults.daft.maxPages, undefined);
  assert.equal(defaults.daft.requestDelayMs, 1_000);
  assert.equal(defaults.polling.cron, DEFAULT_POLL_CRON);
  assert.equal(defaults.polling.timezone, DEFAULT_TIMEZONE);
  assert.equal(new ConfigurationError("bad").name, "ConfigurationError");
  assert.equal(new ConfigurationError("bad")._tag, "ConfigurationError");

  const trimmed = parseEnvironment({
    SHOUTRRR_URL: " ntfy://ntfy.sh/daft/ ",
    DAFT_LOCATION: " dublin-city-centre-dublin ",
    DAFT_KEYWORD: " garage ",
    BROWSER_USER_AGENT: " agent ",
  });
  assert.deepEqual(trimmed.daft.locations, ["dublin-city-centre-dublin"]);
  assert.equal(trimmed.daft.sectionPath, "new-homes-for-sale");
  assert.equal(trimmed.daft.filters.keyword, "garage");
  assert.equal(trimmed.shoutrrr.titlePrefix, "Bellwatch new home");
  assert.equal(trimmed.shoutrrr.binary, "shoutrrr");
  assert.equal(trimmed.shoutrrr.timeoutMs, 15_000);
  assert.equal(trimmed.state.file, "/data/state.sqlite");
  assert.equal(trimmed.state.heartbeatFile, "/data/heartbeat");
  assert.equal(trimmed.browser.userAgent, "agent");

  const falseBooleans = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    NOTIFY_EXISTING_ON_FIRST_RUN: "no",
  });
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
        DAFT_REQUEST_DELAY_MS: "999",
      }),
    /DAFT_REQUEST_DELAY_MS must be between/,
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
});
test("omits zero-radius and single-property query duplicates", () => {
  const url = searchUrl(
    {
      ...baseFilters,
      radiusKm: 0,
      propertyTypes: ["houses"],
    },
    1,
  );
  assert.equal(url.searchParams.has("radius"), false);
  assert.deepEqual(url.searchParams.getAll("propertyType"), []);
});

test("encodes multi-segment sections and omits empty optional values", () => {
  const baseUrl = new URL(
    buildDaftSearchUrl({
      baseUrl: "https://example.test",
      sectionPath: "property/to-rent",
      locations: [],
      filters: {
        ...baseFilters,
        radiusKm: undefined,
        keyword: "",
      },
    }),
  );
  assert.equal(baseUrl.pathname, "/property/to-rent/ireland/houses");
  assert.equal(baseUrl.searchParams.has("terms"), false);
  assert.equal(baseUrl.searchParams.has("radius"), false);

  const sentinelUrl = searchUrl({
    ...baseFilters,
    keyword: "Stryker was here!",
  });
  assert.equal(
    sentinelUrl.searchParams.get("terms"),
    "Stryker was here!",
  );
});

test("normalizes and encodes custom Daft base paths", () => {
  const url = new URL(
    buildDaftSearchUrl({
      baseUrl: "https://example.test/root///?stale=1",
      sectionPath: "/property to rent/",
      locations: ["dublin city"],
      filters: {
        ...baseFilters,
        propertyTypes: ["houses", "apartments"],
        radiusKm: undefined,
      },
    }),
  );
  assert.equal(
    url.toString(),
    "https://example.test/root/property%20to%20rent/ireland?location=dublin+city&salePrice_from=300000&salePrice_to=499999&numBeds_from=3&numBeds_to=6&numBaths_from=2&numBaths_to=4&propertyType=houses&propertyType=apartments&mediaTypes=video&terms=garage&adState=sale-agreed&firstPublishDate_from=now-7d%2Fd&viewingTimes_from=2026-08-01&sort=priceDesc",
  );
});

test("covers empty values, parser boundaries, and canonical URL forms", () => {
  const empty = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    BROWSER_USER_AGENT: " ",
    DAFT_KEYWORD: " ",
    DAFT_RADIUS_KM: " ",
  });
  assert.equal(empty.browser.userAgent, undefined);
  assert.equal(empty.daft.filters.keyword, undefined);
  assert.equal(empty.daft.filters.radiusKm, undefined);

  assert.throws(
    () =>
      parseEnvironment({
        HERMES_WEBHOOK_URL: "http://hermes.example/webhook",
        HERMES_WEBHOOK_SECRET: "",
        HERMES_CHAT_ID: "chat",
      }),
    (error: unknown) => {
      assert.equal(
        (error as Error).message,
        "HERMES_WEBHOOK_URL, HERMES_WEBHOOK_SECRET, and HERMES_CHAT_ID must be set together",
      );
      return true;
    },
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_BEDS_MIN: "x1",
      }),
    (error: unknown) => {
      assert.equal((error as Error).message, "DAFT_BEDS_MIN must be an integer");
      return true;
    },
  );

  const boundaries = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_RADIUS_KM: "0",
    DAFT_BEDS_MIN: "15",
    DAFT_BEDS_MAX: "15",
    DAFT_BATHS_MIN: "1",
    DAFT_BATHS_MAX: "5",
    DAFT_MAX_PAGES: "20",
    DAFT_REQUEST_DELAY_MS: "60000",
    DAFT_LOCATION: " dublin-city , dublin-city ",
    DAFT_SECTION_PATH: "property-to-rent///",
    DAFT_KEYWORD: "x".repeat(50),
    DATABASE_URL: "postgres://db.example/daft",
  });
  assert.equal(boundaries.daft.filters.radiusKm, 0);
  assert.equal(boundaries.daft.filters.bedsMin, 15);
  assert.equal(boundaries.daft.filters.bathsMin, 1);
  assert.equal(boundaries.daft.maxPages, 20);
  assert.equal(boundaries.daft.requestDelayMs, 60_000);
  assert.deepEqual(boundaries.daft.locations, ["dublin-city"]);
  assert.equal(boundaries.daft.sectionPath, "property-to-rent");
  assert.equal(boundaries.daft.filters.keyword, "x".repeat(50));
  assert.equal(boundaries.state.databaseUrl, "postgres://db.example/daft");

  for (const value of ["1", "true", "yes", "on"]) {
    assert.equal(
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        NOTIFY_EXISTING_ON_FIRST_RUN: value,
      }).polling.notifyExistingOnFirstRun,
      true,
    );
  }
  for (const value of ["0", "false", "no", "off"]) {
    assert.equal(
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        NOTIFY_EXISTING_ON_FIRST_RUN: value,
      }).polling.notifyExistingOnFirstRun,
      false,
    );
  }
});

test("normalizes runtime timezone discovery failures", () => {
  assert.equal(detectRuntimeTimezone(() => "Europe/Dublin"), "Europe/Dublin");
  assert.equal(detectRuntimeTimezone(() => "Etc/Unknown"), "UTC");
  assert.equal(detectRuntimeTimezone(() => ""), "UTC");
  assert.equal(
    detectRuntimeTimezone(() => {
      throw new Error("Intl unavailable");
    }),
    "UTC",
  );
});

test("covers list trimming, exact validation, and remaining defaults", () => {
  const defaults = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
  });
  assert.deepEqual(defaults.daft.locations, []);
  assert.equal(defaults.polling.notifyExistingOnFirstRun, false);

  const trimmedLists = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_PROPERTY_TYPES: " houses, apartments ",
    DAFT_MEDIA_TYPES: " video, virtual-tour ",
  });
  assert.deepEqual(trimmedLists.daft.filters.propertyTypes, [
    "houses",
    "apartments",
  ]);
  assert.deepEqual(trimmedLists.daft.filters.mediaTypes, [
    "video",
    "virtual-tour",
  ]);

  const assertMessage = (run: () => unknown, message: string) =>
    assert.throws(run, (error: unknown) => {
      assert.equal((error as Error).message, message);
      return true;
    });

  assertMessage(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_PROPERTY_TYPES: "caves,castles",
      }),
    "DAFT_PROPERTY_TYPES contains unsupported values: caves, castles",
  );
  assertMessage(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_MEDIA_TYPES: "photo,audio",
      }),
    "DAFT_MEDIA_TYPES contains unsupported values: photo, audio",
  );
  assertMessage(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        NOTIFY_EXISTING_ON_FIRST_RUN: "sometimes",
      }),
    "NOTIFY_EXISTING_ON_FIRST_RUN must be a boolean",
  );
  assertMessage(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_AVAILABILITY: "unknown",
      }),
    "DAFT_AVAILABILITY must be one of: published, sale-agreed",
  );
  assertMessage(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_BEDS_MIN: "10",
        DAFT_BEDS_MAX: "2",
      }),
    "DAFT_BEDS minimum cannot exceed maximum",
  );
  assertMessage(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_BATHS_MIN: "5",
        DAFT_BATHS_MAX: "1",
      }),
    "DAFT_BATHS minimum cannot exceed maximum",
  );

  const https = parseEnvironment({
    HERMES_WEBHOOK_URL: "https://hermes.example/webhook/",
    HERMES_WEBHOOK_SECRET: "secret",
    HERMES_CHAT_ID: "chat",
    DAFT_SECTION_PATH: "property//to-rent///",
  });
  assert.equal(https.hermes?.url, "https://hermes.example/webhook");
  assert.equal(https.daft.sectionPath, "property//to-rent");
});

test("reports exact optional-choice and section-path errors", () => {
  const assertMessage = (run: () => unknown, message: string) =>
    assert.throws(run, (error: unknown) => {
      assert.equal((error as Error).message, message);
      return true;
    });

  assertMessage(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_RADIUS_KM: "2",
      }),
    "DAFT_RADIUS_KM must be one of: 0, 1, 3, 5, 10, 20",
  );
  assertMessage(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_SECTION_PATH: "/property-to-rent",
      }),
    "DAFT_SECTION_PATH must be a Daft URL path without spaces, query, or fragment",
  );
});
