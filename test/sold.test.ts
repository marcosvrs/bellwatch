import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDaftSoldSearchUrl,
  parseDaftMoney,
  parseDaftSoldPage,
  summarizeDaftSoldPrices,
} from "../src/daft/sold.js";

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

test("builds sold comparable URLs with one location and setup filters", () => {
  const url = new URL(
    buildDaftSoldSearchUrl({
      baseUrl: "https://www.daft.ie",
      locations: ["dublin"],
      finding,
      year: 2026,
    })!,
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
    buildDaftSoldSearchUrl({
      baseUrl: "https://www.daft.ie",
      locations: ["dublin"],
      finding: { ...finding, berRating: "A3" },
      year: 2026,
    })!,
  );
  assert.equal(aUrl.searchParams.get("simplifiedBer_from"), "8");
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
    buildDaftSoldSearchUrl({
      baseUrl: "https://www.daft.ie",
      locations: [],
      finding,
      year: 2026,
    }, 2)!,
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
      finding: { ...finding, eircode: undefined, address: undefined },
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
            { listing: { soldPrice: "€436,000" } },
            { listing: { soldPrice: "€443,000" } },
            { listing: { price: "€470,000" } },
            { listing: { soldPrice: "Not disclosed" } },
          ],
          paging: { currentPage: 2, totalPages: 3 },
        },
      },
    }),
    { prices: [436000, 443000, 470000], currentPage: 2, totalPages: 3 },
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
