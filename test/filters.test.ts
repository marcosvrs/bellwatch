import * as Cron from "effect/Cron";
import assert from "node:assert/strict";
import test from "node:test";
import {
  DAFT_ADDED_IN_LAST_DAYS,
  DAFT_MEDIA_TYPES,
  DAFT_PROPERTY_TYPES,
  addedInLastDateValue,
  daftBerRatingValue,
  type DaftFilters,
} from "../src/daft/filters.js";
import {
  DAFT_SECTION_PATHS,
  daftSectionForPath,
} from "../src/daft/sections.js";
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
  facilities: [],
};
const without = <T extends object, K extends keyof T>(
  value: T,
  ...keys: readonly K[]
): Omit<T, K> => {
  const copy = { ...value };
  for (const key of keys) {
    delete (copy as Partial<T>)[key];
  }
  return copy as Omit<T, K>;
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
  assert.equal(url.pathname, "/new-homes-for-sale/dublin-city-centre-dublin/houses");
  assert.deepEqual(url.searchParams.getAll("location"), []);
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
  assert.deepEqual(url.searchParams.getAll("location"), []);
  assert.deepEqual(url.searchParams.getAll("propertyType"), [
    "houses",
    "apartments",
  ]);
  assert.deepEqual(url.searchParams.getAll("mediaTypes"), [
    "video",
    "virtual-tour",
  ]);
});
test("encodes sale and rental section-specific filters", () => {
  const sale = new URL(
    buildDaftSearchUrl({
      baseUrl: "https://www.daft.ie",
      sectionPath: "property-for-sale",
      locations: ["dublin"],
      filters: {
        ...without(baseFilters, "openViewingsFrom"),
        propertyTypes: ["sites"],
        facilities: ["parking", "wired-for-cable-television"],
        floorSizeMinSqm: 100,
        floorSizeMaxSqm: 250,
        berMin: "C",
        berMax: "A",
        saleType: "auction",
        onlineOffers: true,
      },
    }),
  );
  assert.equal(sale.pathname, "/property-for-sale/dublin/sites");
  assert.deepEqual(sale.searchParams.getAll("location"), []);
  assert.equal(sale.searchParams.get("radius"), "20000");
  assert.equal(sale.searchParams.get("salePrice_from"), "300000");
  assert.equal(sale.searchParams.get("rentalPrice_from"), null);
  assert.equal(sale.searchParams.get("floorSize_from"), "100");
  assert.equal(sale.searchParams.get("floorSize_to"), "250");
  assert.equal(sale.searchParams.get("simplifiedBer_from"), "6");
  assert.equal(sale.searchParams.get("simplifiedBer_to"), "8");
  assert.equal(daftBerRatingValue("exempt"), 0);
  assert.equal(sale.searchParams.get("saleType"), "auction");
  assert.equal(sale.searchParams.get("offersEnabledDisabled"), "true");
  assert.deepEqual(sale.searchParams.getAll("facilities"), [
    "parking",
    "wired-for-cable-television",
  ]);

  const rent = new URL(
    buildDaftSearchUrl({
      baseUrl: "https://www.daft.ie",
      sectionPath: "property-for-rent",
      locations: ["kildare"],
      filters: {
        ...without(baseFilters, "openViewingsFrom"),
        propertyTypes: ["houses", "apartments"],
        priceMinEur: 1_500,
        priceMaxEur: 2_500,
        facilities: ["parking", "pets-allowed"],
        leaseLengthMinMonths: 6,
        leaseLengthMaxMonths: 12,
        furnishing: "furnished",
      },
    }),
  );
  assert.equal(rent.pathname, "/property-for-rent/kildare");
  assert.deepEqual(rent.searchParams.getAll("location"), []);
  assert.equal(rent.searchParams.get("radius"), "20000");
  assert.equal(rent.searchParams.get("salePrice_from"), null);
  assert.equal(rent.searchParams.get("rentalPrice_from"), "1500");
  assert.equal(rent.searchParams.get("rentalPrice_to"), "2500");
  assert.deepEqual(rent.searchParams.getAll("propertyType"), [
    "houses",
    "apartments",
  ]);
  assert.equal(rent.searchParams.get("leaseLength_from"), "6");
  assert.equal(rent.searchParams.get("leaseLength_to"), "12");
  assert.equal(rent.searchParams.get("furnishing"), "furnished");
  assert.deepEqual(rent.searchParams.getAll("facilities"), [
    "parking",
    "pets-allowed",
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
    propertyTypes: [],
    mediaTypes: [],
    availability: "published",
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
test("requires one location per Daft search URL", () => {
  assert.throws(
    () => searchUrl(baseFilters, 1, ["dublin", "kildare"]),
    /one location at a time/,
  );
  const ireland = searchUrl(baseFilters, 1, []);
  assert.equal(ireland.searchParams.get("radius"), null);
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
  assert.equal(config.daft.filters.bedsMax, 6);
  assert.equal(config.daft.filters.bathsMin, 2);
  assert.equal(config.daft.filters.bathsMax, 4);
  assert.deepEqual(config.daft.filters.propertyTypes, ["houses", "apartments"]);
  assert.deepEqual(config.daft.filters.mediaTypes, ["video", "virtual-tour"]);
  assert.equal(config.daft.filters.addedInLastDays, 14);
  assert.equal(config.daft.filters.openViewingsFrom, "2026-08-01");
  assert.equal(config.daft.filters.sort, "publishDateDesc");
});
test("parses profile-specific filters and rejects incompatible combinations", () => {
  const sale = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_SECTION_PATH: "property-for-sale",
    DAFT_FLOOR_SIZE_MIN_SQM: "100",
    DAFT_FLOOR_SIZE_MAX_SQM: "250",
    DAFT_BER_MIN: "C",
    DAFT_BER_MAX: "A",
    DAFT_SALE_TYPE: "auction",
    DAFT_ONLINE_OFFERS: "true",
    DAFT_FACILITIES: "parking,wired-for-cable-television",
  });
  assert.equal(sale.daft.sectionPath, "property-for-sale");
  assert.equal(sale.daft.filters.priceMaxEur, undefined);
  assert.equal(sale.daft.filters.floorSizeMinSqm, 100);
  assert.equal(sale.daft.filters.floorSizeMaxSqm, 250);
  assert.equal(sale.daft.filters.berMin, "C");
  assert.equal(sale.daft.filters.berMax, "A");
  assert.equal(sale.daft.filters.saleType, "auction");
  assert.equal(sale.daft.filters.onlineOffers, true);
  assert.deepEqual(sale.daft.filters.facilities, [
    "parking",
    "wired-for-cable-television",
  ]);
  assert.equal(sale.shoutrrr.titlePrefix, "Bellwatch property sale");

  const rent = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_SECTION_PATH: "property-for-rent",
    DAFT_LEASE_LENGTH_MIN_MONTHS: "6",
    DAFT_LEASE_LENGTH_MAX_MONTHS: "12",
    DAFT_FURNISHING: "furnished",
    DAFT_FACILITIES: "parking,pets-allowed",
  });
  assert.equal(rent.daft.filters.leaseLengthMinMonths, 6);
  assert.equal(rent.daft.filters.leaseLengthMaxMonths, 12);
  assert.equal(rent.daft.filters.furnishing, "furnished");
  assert.deepEqual(rent.daft.filters.facilities, ["parking", "pets-allowed"]);
  assert.equal(rent.shoutrrr.titlePrefix, "Bellwatch rental");

  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_SECTION_PATH: "property-for-rent",
        DAFT_OPEN_VIEWINGS_FROM: "2026-08-01",
      }),
    /DAFT_OPEN_VIEWINGS_FROM is not supported for property-for-rent/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_SECTION_PATH: "property-for-sale",
        SHPS_FILTER: "only",
      }),
    /SHPS_FILTER is only supported for new-homes-for-sale/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_SECTION_PATH: "property-for-sale",
        DAFT_FACILITIES: "pets-allowed",
      }),
    /DAFT_FACILITIES contains values unsupported for property-for-sale/,
  );
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
    DAFT_SECTION_PATH: "property-for-rent",
    DAFT_REQUEST_DELAY_MS: "2500",
    PLAYWRIGHT_WS_ENDPOINT: "wss://browser.example/playwright",
    DATABASE_URL: "postgresql://user:password@db.example/daft",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  assert.equal(configured.shoutrrr.url, "ntfy://ntfy.sh/daft");
  assert.equal(configured.daft.baseUrl, "http://fixture.example:8080");
  assert.equal(configured.daft.sectionPath, "property-for-rent");
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
      priceMaxEur: 499_999,
      propertyTypes: [],
      mediaTypes: [],
      availability: "published",
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
    priceMaxEur: 499_999,
    propertyTypes: [],
    mediaTypes: [],
    availability: "published",
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
  assert.equal(Object.hasOwn(defaults.daft, "maxPages"), false);
  assert.equal(Object.hasOwn(defaults.browser, "externalEndpoint"), false);
  assert.equal(Object.hasOwn(defaults.browser, "userAgent"), false);
  assert.equal(Object.hasOwn(defaults.state, "databaseUrl"), false);
  const saleDefaults = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_SECTION_PATH: "property-for-sale",
  });
  assert.equal(Object.hasOwn(saleDefaults.daft.filters, "priceMaxEur"), false);
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
        ...without(baseFilters, "radiusKm"),
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
        ...without(baseFilters, "radiusKm"),
        propertyTypes: ["houses", "apartments"],
      },
    }),
  );
  assert.equal(
    url.toString(),
    "https://example.test/root/property%20to%20rent/dublin%20city?salePrice_from=300000&salePrice_to=499999&numBeds_from=3&numBeds_to=6&numBaths_from=2&numBaths_to=4&propertyType=houses&propertyType=apartments&mediaTypes=video&terms=garage&adState=sale-agreed&firstPublishDate_from=now-7d%2Fd&viewingTimes_from=2026-08-01&sort=priceDesc",
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
    DAFT_SECTION_PATH: "property-for-rent///",
    DAFT_KEYWORD: "x".repeat(50),
    DATABASE_URL: "postgres://db.example/daft",
  });
  assert.equal(boundaries.daft.filters.radiusKm, 0);
  assert.equal(boundaries.daft.filters.bedsMin, 15);
  assert.equal(boundaries.daft.filters.bathsMin, 1);
  assert.equal(boundaries.daft.maxPages, 20);
  assert.equal(boundaries.daft.requestDelayMs, 60_000);
  assert.deepEqual(boundaries.daft.locations, ["dublin-city"]);
  assert.equal(boundaries.daft.sectionPath, "property-for-rent");
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
    DAFT_SECTION_PATH: "property-for-rent///",
  });
  assert.equal(https.hermes?.url, "https://hermes.example/webhook");
  assert.equal(https.daft.sectionPath, "property-for-rent");
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

test("covers section metadata and profile validation boundaries", () => {
  assert.deepEqual(DAFT_SECTION_PATHS, [
    "new-homes-for-sale",
    "property-for-sale",
    "property-for-rent",
  ]);
  assert.deepEqual(daftSectionForPath("unknown"), undefined);
  assert.deepEqual(
    {
      ...daftSectionForPath("new-homes-for-sale"),
      encodeFilters: undefined,
    },
    {
      id: "new-homes",
      path: "new-homes-for-sale",
      priceParameter: "salePrice",
      defaultPriceMaxEur: 499_999,
      supportsShps: true,
      notificationTitlePrefix: "Bellwatch new home",
      allowedFacilities: [],
      encodeFilters: undefined,
    },
  );
  assert.deepEqual(
    {
      ...daftSectionForPath("property-for-sale"),
      encodeFilters: undefined,
    },
    {
      id: "property-sale",
      path: "property-for-sale",
      priceParameter: "salePrice",
      supportsShps: false,
      notificationTitlePrefix: "Bellwatch property sale",
      allowedFacilities: [
        "alarm",
        "gas-fired-central-heating",
        "oil-fired-central-heating",
        "parking",
        "wheelchair-access",
        "wired-for-cable-television",
      ],
      encodeFilters: undefined,
    },
  );
  assert.deepEqual(
    {
      ...daftSectionForPath("property-for-rent"),
      encodeFilters: undefined,
    },
    {
      id: "property-rent",
      path: "property-for-rent",
      priceParameter: "rentalPrice",
      supportsShps: false,
      notificationTitlePrefix: "Bellwatch rental",
      allowedFacilities: [
        "alarm",
        "cable-television",
        "central-heating",
        "dishwasher",
        "dryer",
        "garden-patio-balcony",
        "internet",
        "microwave",
        "parking",
        "pets-allowed",
        "serviced-property",
        "smoking",
        "washing-machine",
        "wheelchair-access",
      ],
      encodeFilters: undefined,
    },
  );

  const saleWithFalseOffers = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_SECTION_PATH: "property-for-sale",
    DAFT_ONLINE_OFFERS: "false",
    DAFT_FACILITIES: "any",
  });
  assert.equal(saleWithFalseOffers.daft.filters.onlineOffers, false);
  assert.deepEqual(saleWithFalseOffers.daft.filters.facilities, undefined);

  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_SECTION_PATH: "property-for-rent",
        DAFT_FACILITIES: "any,parking",
      }),
    /cannot combine any with specific values/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_SECTION_PATH: "property-for-sale",
        DAFT_LEASE_LENGTH_MIN_MONTHS: "6",
      }),
    /DAFT_LEASE_LENGTH_MIN_MONTHS, DAFT_LEASE_LENGTH_MAX_MONTHS, DAFT_FURNISHING is not supported/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_SECTION_PATH: "property-for-rent",
        DAFT_FLOOR_SIZE_MIN_SQM: "100",
      }),
    /DAFT_FLOOR_SIZE_MIN_SQM, DAFT_FLOOR_SIZE_MAX_SQM, DAFT_BER_MIN/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_SECTION_PATH: "property-for-sale",
        DAFT_BER_MIN: "A",
        DAFT_BER_MAX: "C",
      }),
    /DAFT_BER_MIN must not exceed DAFT_BER_MAX/,
  );
  assert.equal(
    parseEnvironment({
      SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
      DAFT_SECTION_PATH: "property-for-sale",
      DAFT_BER_MIN: "C",
    }).daft.filters.berMin,
    "C",
  );
  assert.equal(
    parseEnvironment({
      SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
      DAFT_SECTION_PATH: "property-for-sale",
      DAFT_BER_MAX: "A",
    }).daft.filters.berMax,
    "A",
  );
});

test("covers remaining section encoders and configuration failure messages", () => {
  const saleWithoutOptionalFilters = new URL(
    buildDaftSearchUrl({
      baseUrl: "https://www.daft.ie",
      sectionPath: "property-for-sale",
      locations: ["dublin"],
      filters: {
        ...without(baseFilters, "facilities"),
        onlineOffers: false,
      },
    }),
  );
  assert.equal(
    saleWithoutOptionalFilters.searchParams.get("offersEnabledDisabled"),
    "false",
  );
  assert.equal(
    saleWithoutOptionalFilters.searchParams.get("simplifiedBer_from"),
    null,
  );
  assert.equal(
    saleWithoutOptionalFilters.searchParams.get("simplifiedBer_to"),
    null,
  );
  assert.deepEqual(
    saleWithoutOptionalFilters.searchParams.getAll("facilities"),
    [],
  );
  const saleWithoutOnlineOffers = new URL(
    buildDaftSearchUrl({
      baseUrl: "https://www.daft.ie",
      sectionPath: "property-for-sale",
      locations: ["dublin"],
      filters: { ...baseFilters, facilities: [] },
    }),
  );
  assert.equal(
    saleWithoutOnlineOffers.searchParams.get("offersEnabledDisabled"),
    null,
  );


  const rentWithoutFacilities = new URL(
    buildDaftSearchUrl({
      baseUrl: "https://www.daft.ie",
      sectionPath: "property-for-rent",
      locations: ["dublin"],
      filters: without(baseFilters, "facilities"),
    }),
  );
  assert.deepEqual(rentWithoutFacilities.searchParams.getAll("facilities"), []);
  assert.equal(daftSectionForPath("toString"), undefined);

  const invalidFacility = () =>
    parseEnvironment({
      SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
      DAFT_FACILITIES: "not-a-facility,another-invalid-facility",
    });
  assert.throws(
    invalidFacility,
    /DAFT_FACILITIES contains unsupported values: not-a-facility, another-invalid-facility/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_FACILITIES: "parking",
      }),
    /DAFT_FACILITIES is not supported for new-homes-for-sale/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_SECTION_PATH: "property-for-sale",
        DAFT_FACILITIES: "pets-allowed,central-heating",
      }),
    /DAFT_FACILITIES contains values unsupported for property-for-sale: pets-allowed, central-heating/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_SECTION_PATH: "property-for-rent",
        DAFT_FLOOR_SIZE_MIN_SQM: "100",
        DAFT_FLOOR_SIZE_MAX_SQM: "200",
        DAFT_BER_MIN: "A",
        DAFT_BER_MAX: "C",
        DAFT_SALE_TYPE: "auction",
        DAFT_ONLINE_OFFERS: "true",
      }),
    /DAFT_FLOOR_SIZE_MIN_SQM, DAFT_FLOOR_SIZE_MAX_SQM, DAFT_BER_MIN, DAFT_BER_MAX, DAFT_SALE_TYPE, DAFT_ONLINE_OFFERS is not supported for property-for-rent/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_SECTION_PATH: "property-for-rent",
        DAFT_LEASE_LENGTH_MIN_MONTHS: "12",
        DAFT_LEASE_LENGTH_MAX_MONTHS: "6",
      }),
    /DAFT_LEASE_LENGTH minimum cannot exceed maximum/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_SECTION_PATH: "property-for-sale",
        DAFT_FLOOR_SIZE_MIN_SQM: "200",
        DAFT_FLOOR_SIZE_MAX_SQM: "100",
      }),
    /DAFT_FLOOR_SIZE minimum cannot exceed maximum/,
  );
  assert.equal(
    parseEnvironment({
      SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
      DAFT_SECTION_PATH: "property-for-sale",
      DAFT_BER_MIN: "A",
      DAFT_BER_MAX: "A",
    }).daft.filters.berMin,
    "A",
  );
  assert.deepEqual(
    parseEnvironment({
      SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
      DAFT_LOCATION: "dublin///city///",
    }).daft.locations,
    ["dublin///city"],
  );
  assert.throws(
    () =>
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_SECTION_PATH: "not-a-daft-section",
      }),
    /DAFT_SECTION_PATH must be one of: new-homes-for-sale, property-for-sale, property-for-rent/,
  );
});
