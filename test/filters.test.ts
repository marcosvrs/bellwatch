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
import { buildDaftSearchUrl } from "../src/daft/url.js";
import { parseEnvironment } from "../src/config.js";

const baseFilters: DaftFilters = {
  locationPath: "dublin-city-centre-dublin",
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

const searchUrl = (filters: DaftFilters = baseFilters, page = 1) =>
  new URL(
    buildDaftSearchUrl(
      {
        baseUrl: "https://www.daft.ie",
        sectionPath: "new-homes-for-sale",
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

test("accepts Daft web filters from environment variables", () => {
  const config = parseEnvironment({
    NTFY_URL: "https://ntfy.example/daft",
    DAFT_LOCATION_PATH: "dublin-city-centre-dublin",
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
  assert.equal(config.daft.filters.radiusKm, 5);
  assert.deepEqual(config.daft.filters.propertyTypes, ["houses", "apartments"]);
  assert.deepEqual(config.daft.filters.mediaTypes, ["video", "virtual-tour"]);
  assert.equal(config.daft.filters.addedInLastDays, 14);
  assert.equal(config.daft.filters.openViewingsFrom, "2026-08-01");
  assert.equal(config.daft.filters.sort, "publishDateDesc");
});

test("rejects invalid or contradictory filter configuration", () => {
  assert.throws(
    () => parseEnvironment({ NTFY_URL: "https://ntfy.example/daft", DAFT_RADIUS_KM: "2" }),
    /DAFT_RADIUS_KM must be one of/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        NTFY_URL: "https://ntfy.example/daft",
        DAFT_PRICE_MIN_EUR: "500000",
        DAFT_PRICE_MAX_EUR: "400000",
      }),
    /DAFT_PRICE minimum cannot exceed maximum/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        NTFY_URL: "https://ntfy.example/daft",
        DAFT_OPEN_VIEWINGS_FROM: "2026-02-30",
      }),
    /DAFT_OPEN_VIEWINGS_FROM must be a real calendar date/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        NTFY_URL: "https://ntfy.example/daft",
        DAFT_PROPERTY_TYPES: "any,apartments",
      }),
    /DAFT_PROPERTY_TYPES cannot combine any/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        NTFY_URL: "https://ntfy.example/daft",
        DAFT_MEDIA_TYPES: "any,video",
      }),
    /DAFT_MEDIA_TYPES cannot combine any/,
  );
});
