import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDaftSoldSearchUrl,
  hasDaftSoldMatchFields,
  parseDaftMoney,
  parseDaftSoldPage,
  parseListingFloorSize,
  soldPropertyTypePath,
  summarizeDaftSoldPrices,
} from "../src/daft/sold.js";
import { defined } from "./helpers.js";

const finding = {
  address: "Apartment 3, 70 Leeson Close, Dublin 2",
  berRating: "B2",
  bedrooms: 2,
  bathrooms: 2,
  eircode: "D02W838",
  floorSizeSqm: 68,
  priceText: "€500,000",
  propertyType: "Semi-D",
};
const without = <T extends object, K extends keyof T>(
  value: T,
  ...keys: readonly K[]
): Omit<T, K> => {
  const copy: Partial<T> = { ...value };
  for (const key of keys) {
    delete copy[key];
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Generic key deletion is not expressible without a boundary assertion.
  return copy as Omit<T, K>;
};

test("builds sold comparable URLs with one location and setup filters", () => {
  const url = new URL(
    defined(buildDaftSoldSearchUrl({
      baseUrl: "https://www.daft.ie",
      locations: ["dublin"],
      finding,
      year: 2026,
    })),
  );

  assert.equal(url.pathname, "/sold-properties/ireland/semi-detached-houses");
  assert.deepEqual(url.searchParams.getAll("location"), ["dublin"]);
  assert.equal(url.searchParams.get("numBeds_from"), "2");
  assert.equal(url.searchParams.get("numBeds_to"), null);
  assert.equal(url.searchParams.get("numBaths_from"), "2");
  assert.equal(url.searchParams.get("numBaths_to"), null);
  assert.equal(url.searchParams.get("simplifiedBer_from"), "7");
  assert.equal(url.searchParams.get("simplifiedBer_to"), null);
  assert.equal(url.searchParams.get("floorSize_from"), "68");
  assert.equal(url.searchParams.get("floorSize_to"), null);
  const aUrl = new URL(
    defined(buildDaftSoldSearchUrl({
      baseUrl: "https://www.daft.ie",
      locations: ["dublin"],
      finding: { ...finding, berRating: "A3" },
      year: 2026,
    })),
  );
  assert.equal(aUrl.searchParams.get("simplifiedBer_from"), "8");
  const spacedBerUrl = new URL(
    defined(buildDaftSoldSearchUrl({
      baseUrl: "https://www.daft.ie",
      locations: ["dublin"],
      finding: { ...finding, berRating: " A " },
      year: 2026,
    })),
  );
  assert.equal(spacedBerUrl.searchParams.get("simplifiedBer_from"), "8");
  const emptyBerUrl = new URL(
    defined(buildDaftSoldSearchUrl({
      baseUrl: "https://www.daft.ie",
      locations: ["dublin"],
      finding: { ...finding, berRating: "" },
      year: 2026,
    })),
  );
  assert.equal(emptyBerUrl.searchParams.get("simplifiedBer_from"), null);
  const missingBerUrl = new URL(
    defined(buildDaftSoldSearchUrl({
      baseUrl: "https://www.daft.ie",
      locations: ["dublin"],
      finding: without(finding, "berRating"),
      year: 2026,
    })),
  );
  assert.equal(missingBerUrl.searchParams.get("simplifiedBer_from"), null);
  assert.equal(url.searchParams.get("soldDate_from"), "2026");
  assert.equal(url.searchParams.get("page"), null);
});
test("requires one location per sold URL", () => {
  assert.throws(
    () =>
      buildDaftSoldSearchUrl({
        baseUrl: "https://www.daft.ie",
        locations: ["dublin", "kildare"],
        finding,
        year: 2026,
      }),
    /one location at a time/,
  );
});

test("falls back to exact-address geofiltering when no location is configured", () => {
  const url = new URL(
    defined(buildDaftSoldSearchUrl({
      baseUrl: "https://www.daft.ie",
      locations: [],
      finding,
      year: 2026,
    }, 2)),
  );
  const addressUrl = new URL(
    defined(buildDaftSoldSearchUrl({
      baseUrl: "https://www.daft.ie",
      locations: [],
      finding: without(finding, "eircode"),
      year: 2026,
    })),
  );
  assert.equal(addressUrl.searchParams.get("name"), "eircode");
  assert.equal(addressUrl.searchParams.get("filterType"), "Eircode");
  assert.equal(addressUrl.searchParams.get("searchQueryGroup"), "geoFilter");
  assert.equal(
    addressUrl.searchParams.get("geoSearchType"),
    "POINT_AND_EIRCODE",
  );

  assert.equal(url.pathname, "/sold-properties/ireland/semi-detached-houses");
  assert.equal(url.searchParams.get("name"), "eircode");
  assert.equal(url.searchParams.get("filterType"), "Eircode");
  assert.equal(url.searchParams.get("geoSearchType"), "POINT_AND_EIRCODE");
  assert.equal(url.searchParams.get("eircode"), "D02W838");
  assert.equal(url.searchParams.get("address"), null);
  assert.equal(url.searchParams.get("rad"), "1000");
  assert.equal(url.searchParams.get("page"), "2");
});

test("skips sold lookup without a spatial constraint", () => {
  assert.equal(
    buildDaftSoldSearchUrl({
      baseUrl: "https://www.daft.ie",
      locations: [],
      finding: without(finding, "eircode", "address"),
      year: 2026,
    }),
    undefined,
  );
});

test("parses sold prices and paging from Daft payloads", () => {
  assert.equal(parseDaftMoney("€436,000"), 436000);
  assert.equal(parseDaftMoney("€450k"), 450000);
  assert.deepEqual(
    parseDaftSoldPage({
      props: {
        pageProps: {
          listings: [
            { listing: { id: 9001, soldPrice: "€436,000" } },
            { listing: { id: "9002", soldPrice: "€443,000" } },
            { listing: { id: "sale-x", soldPrice: "€460,000" } },
            { listing: { id: "  ", soldPrice: "€480,000" } },
            { listing: { price: "€470,000" } },
            { listing: { soldPrice: "Not disclosed" } },
          ],
          paging: { currentPage: 2, totalPages: 3 },
        },
      },
    }),
    {
      comparables: [
        { id: "9001", price: 436000 },
        { id: "9002", price: 443000 },
        { id: "sale-x", price: 460000 },
        { price: 480000 },
        { price: 470000 },
      ],
      currentPage: 2,
      totalPages: 3,
    },
  );
});

test("classifies an asking price against the sold range", () => {
  assert.deepEqual(summarizeDaftSoldPrices([400000, 450000], 2026, "€500,000"), {
    year: 2026,
    comparableCount: 2,
    minPriceEur: 400000,
    maxPriceEur: 450000,
    askingPriceEur: 500000,
    verdict: "above",
  });
  assert.deepEqual(summarizeDaftSoldPrices([], 2026, "€500,000"), {
    year: 2026,
    comparableCount: 0,
    askingPriceEur: 500000,
  });
});

test("covers sold parsing, property types, and comparison boundaries", () => {
  assert.equal(parseDaftMoney(undefined), undefined);
  assert.equal(parseDaftMoney(" "), undefined);
  assert.equal(parseDaftMoney("€1.25m"), 1_250_000);
  assert.equal(parseDaftMoney("450 K"), 450_000);
  assert.equal(parseDaftMoney("€1,250.50"), 1_250.5);
  assert.equal(parseDaftMoney("€400,000–€450,000"), undefined);
  assert.equal(
    soldPropertyTypePath("  End   of\tTerrace "),
    "end-of-terrace-houses",
  );
  assert.equal(parseDaftMoney("Not disclosed"), undefined);

  const propertyTypes = new Map([
    ["Studio apartment", "studio-apartments"],
    ["Duplex", "duplexes"],
    ["End of terrace", "end-of-terrace-houses"],
    ["Semi-D", "semi-detached-houses"],
    ["Detached", "detached-houses"],
    ["Terrace", "terraced-houses"],
    ["Townhouse", "townhouses"],
    ["Bungalow", "bungalows"],
    ["Apartment", "apartments"],
    ["Site", "sites"],
    ["House", "houses"],
  ]);
  for (const [value, path] of propertyTypes) {
    assert.equal(soldPropertyTypePath(value), path);
  }
  assert.equal(soldPropertyTypePath(""), undefined);
  assert.equal(soldPropertyTypePath("unknown"), undefined);

  const complete = {
    bedrooms: 2,
    bathrooms: 1,
    floorSizeSqm: 70,
    berRating: "B2",
    propertyType: "House",
  };
  for (const field of [
    "bedrooms",
    "bathrooms",
    "floorSizeSqm",
    "berRating",
    "propertyType",
  ] as const) {
    assert.equal(
      hasDaftSoldMatchFields({ ...complete, [field]: undefined }),
      false,
    );
  }
  assert.equal(hasDaftSoldMatchFields(complete), true);
  assert.equal(
    hasDaftSoldMatchFields({ ...complete, berRating: "N/A" }),
    false,
  );

  assert.deepEqual(
    parseDaftSoldPage({
      listings: [
        { listing: { soldPrice: 123_000 } },
        { listing: { price: "€1k" } },
        { listing: { soldPrice: " " } },
        null,
      ],
      paging: { currentPage: "2", totalPages: "3" },
    }),
    {
      comparables: [{ price: 123_000 }, { price: 1_000 }],
      currentPage: 2,
      totalPages: 3,
    },
  );
  assert.deepEqual(parseDaftSoldPage({ listings: [], paging: {} }), {
    comparables: [],
    currentPage: 1,
    totalPages: 1,
  });
  assert.deepEqual(
    parseDaftSoldPage({
      listings: [],
      paging: { currentPage: " ", totalPages: "\t" },
    }),
    { comparables: [], currentPage: 1, totalPages: 1 },
  );

  assert.equal(
    parseListingFloorSize({ floorArea: { value: 88 } }),
    88,
  );
  assert.equal(
    parseListingFloorSize({
      floorArea: { value: 100, unit: "METRES_SQUARED" },
    }),
    100,
  );
  assert.equal(
    parseListingFloorSize({
      floorArea: { value: 100, unit: "FEET_SQUARED" },
    }),
    9.290304,
  );
  assert.equal(
    parseListingFloorSize({
      floorArea: { value: 100, unit: "UNKNOWN" },
    }),
    undefined,
  );
  assert.equal(parseListingFloorSize({ propertySize: "105.5 sqm" }), 105.5);
  assert.equal(
    parseListingFloorSize({ propertySize: "1,234.56 square metres" }),
    1234.56,
  );
  assert.equal(
    parseListingFloorSize({ propertySize: "100 sq ft" }),
    undefined,
  );
  assert.equal(
    parseListingFloorSize({ propertySize: "100 square feet" }),
    undefined,
  );
  assert.equal(
    parseListingFloorSize({
      floorArea: { value: "bad", unit: "FEET_SQUARED" },
      propertySize: "105 sqm",
    }),
    105,
  );
  assert.equal(parseListingFloorSize({ propertySize: 105 }), undefined);
  assert.equal(parseListingFloorSize({ propertySize: "unknown" }), undefined);

  assert.deepEqual(summarizeDaftSoldPrices([], 2026, undefined), {
    year: 2026,
    comparableCount: 0,
  });
  assert.equal(
    summarizeDaftSoldPrices([400_000, 450_000], 2026, "€350,000").verdict,
    "below",
  );
  assert.equal(
    summarizeDaftSoldPrices([400_000, 450_000], 2026, "€400,000").verdict,
    "within",
  );
  assert.equal(
    summarizeDaftSoldPrices([400_000, 450_000], 2026, "€450,000").verdict,
    "within",
  );
  assert.equal(
    summarizeDaftSoldPrices([400_000, 450_000], 2026, undefined).verdict,
    "unavailable",
  );
});

test("encodes sold URL fallbacks and optional filters", () => {
  const addressUrl = new URL(
    defined(buildDaftSoldSearchUrl({
      baseUrl: "https://www.daft.ie/root///",
      locations: [],
      finding: {
        ...without(
          finding,
          "eircode",
          "bedrooms",
          "bathrooms",
          "floorSizeSqm",
        ),
        address: "1 Main Street, Dublin",
        berRating: "EXEMPT",
        propertyType: "A0",
      },
      year: 2026,
    }, 2)),
  );
  assert.equal(
    addressUrl.pathname,
    "/root/sold-properties/ireland",
  );
  assert.equal(addressUrl.searchParams.get("name"), "eircode");
  assert.equal(addressUrl.searchParams.get("address"), "1 Main Street, Dublin");
  assert.equal(addressUrl.searchParams.get("eircode"), null);
  assert.equal(addressUrl.searchParams.get("rad"), "1000");
  assert.equal(addressUrl.searchParams.get("simplifiedBer_from"), "0");
  assert.equal(addressUrl.searchParams.get("page"), "2");

  assert.throws(
    () =>
      buildDaftSoldSearchUrl({
        baseUrl: "https://www.daft.ie",
        locations: ["dublin"],
        finding,
        year: 2026,
      }, 0),
    /positive integer/,
  );
  assert.throws(
    () =>
      buildDaftSoldSearchUrl({
        baseUrl: "https://www.daft.ie",
        locations: ["dublin"],
        finding,
        year: 2026,
      }, 1.5),
    /positive integer/,
  );
});

test("rejects malformed sold payload values and encodes every geofilter", () => {
  assert.equal(parseDaftMoney(" 450 K "), 450_000);
  assert.equal(parseDaftMoney("  1 250  "), 1_250);

  const eircodeUrl = new URL(
    defined(buildDaftSoldSearchUrl({
      baseUrl: "https://www.daft.ie",
      locations: [],
      finding: without(finding, "address"),
      year: 2026,
    })),
  );
  assert.equal(eircodeUrl.searchParams.get("filterType"), "Eircode");
  assert.equal(eircodeUrl.searchParams.get("searchQueryGroup"), "geoFilter");
  assert.equal(
    eircodeUrl.searchParams.get("geoSearchType"),
    "POINT_AND_EIRCODE",
  );
  assert.equal(eircodeUrl.searchParams.get("numBeds_to"), null);
  assert.equal(eircodeUrl.searchParams.get("numBaths_to"), null);

  const a0Url = new URL(
    defined(buildDaftSoldSearchUrl({
      baseUrl: "https://www.daft.ie",
      locations: ["dublin"],
      finding: { ...finding, berRating: "a0", propertyType: "Semi-D" },
      year: 2026,
    })),
  );
  assert.equal(a0Url.searchParams.get("simplifiedBer_from"), "9");
  const unknownBerUrl = new URL(
    defined(buildDaftSoldSearchUrl({
      baseUrl: "https://www.daft.ie",
      locations: ["dublin"],
      finding: { ...finding, berRating: "Z" },
      year: 2026,
    })),
  );
  assert.equal(unknownBerUrl.searchParams.get("simplifiedBer_from"), null);
  assert.equal(
    new URL(
      defined(buildDaftSoldSearchUrl({
        baseUrl: "https://www.daft.ie",
        locations: ["dublin"],
        finding: { ...finding, propertyType: "End--of terrace" },
        year: 2026,
      })),
    ).pathname,
    "/sold-properties/ireland/end-of-terrace-houses",
  );

  assert.deepEqual(parseDaftSoldPage(null), {
    comparables: [],
    currentPage: 1,
    totalPages: 1,
  });
  assert.deepEqual(
    parseDaftSoldPage({
      props: { pageProps: { listings: {}, paging: {} } },
    }),
    {
      comparables: [],
      currentPage: 1,
      totalPages: 1,
    },
  );
  assert.deepEqual(
    parseDaftSoldPage({
      listings: [
        { listing: { soldPrice: Number.NaN } },
        { listing: { price: Number.POSITIVE_INFINITY } },
      ],
      paging: { currentPage: Number.NaN, totalPages: Number.POSITIVE_INFINITY },
    }),
    {
      comparables: [],
      currentPage: 1,
      totalPages: 1,
    },
  );

  const unavailable = summarizeDaftSoldPrices(
    [400_000],
    2026,
    undefined,
  );
  assert.equal(Object.hasOwn(unavailable, "askingPriceEur"), false);
});

test("ignores array-shaped sold payload roots", () => {
  const arrayPayload = Object.assign([], {
    props: {
      pageProps: {
        listings: [{ listing: { soldPrice: "€1" } }],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  });
  assert.deepEqual(parseDaftSoldPage(arrayPayload), {
    comparables: [],
    currentPage: 1,
    totalPages: 1,
  });
});
