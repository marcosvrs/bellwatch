import assert from "node:assert/strict";
import test from "node:test";
import { parseDaftPage, parseNextDataScript } from "../src/daft/parser.js";

const payload = {
  props: {
    pageProps: {
      listings: [
        {
          listing: {
            id: 100,
            title: "Example Development, Dublin",
            price: "From €300,000",
            publishDate: 1_700_000_000_000,
            seoFriendlyPath: "/new-home-for-sale/example-development/100",
            newHome: {
              developmentName: "Example Development",
              subUnits: [
                {
                  id: 101,
                  price: "€315,000",
                  numBedrooms: "3 Bed",
                  numBathrooms: "2 Bath",
                  propertyType: "Terrace",
                  seoFriendlyPath: "/new-home-for-sale/3-bed-example/101",
                },
              ],
            },
          },
        },
        {
          listing: {
            id: 200,
            title: "No Unit Development",
            price: "From €400,000",
            seoFriendlyPath: "/new-home-for-sale/no-unit-development/200",
            newHome: { totalUnitTypes: 2 },
          },
        },
      ],
      paging: { currentPage: 1, totalPages: 2, totalResults: 21 },
    },
  },
};

test("parses unit findings and development fallbacks", () => {
  const result = parseDaftPage(payload, "https://www.daft.ie");
  assert.equal(result.currentPage, 1);
  assert.equal(result.totalPages, 2);
  assert.equal(result.totalResults, 21);
  assert.equal(result.findings.length, 2);
  assert.deepEqual(result.findings[0], {
    id: "101",
    title: "Example Development — 3 Bed · 2 Bath · Terrace",
    developmentTitle: "Example Development",
    priceText: "€315,000",
    priceEur: 315000,
    bedrooms: 3,
    bathrooms: 2,
    propertyType: "Terrace",
    url: "https://www.daft.ie/new-home-for-sale/3-bed-example/101",
    publishedAt: "2023-11-14T22:13:20.000Z",
    source: "unit",
  });
  assert.equal(result.findings[1].id, "200");
  assert.equal(result.findings[1].source, "development");
  assert.equal(result.findings[1].priceEur, 400000);
});

test("handles malformed and string-valued listing data", () => {
  const result = parseDaftPage(
    {
      props: {
        pageProps: {
          listings: [
            null,
            { listing: null },
            {
              listing: {
                id: "300",
                publishDate: "1700000000000",
                newHome: {
                  developmentName: "String-valued Development",
                  subUnits: [{}, { id: "301" }],
                },
              },
            },
            {
              listing: {
                id: 302,
                newHome: { subUnits: [] },
              },
            },
            { listing: { title: "Missing id" } },
          ],
          paging: {},
        },
      },
    },
    "https://www.daft.ie",
  );
  assert.equal(result.findings.length, 2);
  assert.equal(result.findings[0].id, "301");
  assert.equal(result.findings[0].title, "String-valued Development");
  assert.equal(result.findings[0].publishedAt, "2023-11-14T22:13:20.000Z");
  assert.equal(result.findings[0].priceText, "Price unavailable");
  assert.equal(result.findings[1].id, "302");
  assert.equal(result.findings[1].title, "Daft development 302");
  assert.equal(result.findings[1].priceText, "Price unavailable");
  assert.deepEqual(parseDaftPage(null, "https://www.daft.ie"), {
    findings: [],
    currentPage: 1,
    totalPages: 1,
    totalResults: undefined,
  });
});

test("rejects malformed Next data JSON with its cause", () => {
  assert.throws(
    () =>
      parseNextDataScript(
        `<script id="__NEXT_DATA__" type="application/json">{oops}</script>`,
      ),
    (error: unknown) => {
      assert.match(String(error), /__NEXT_DATA__ was not valid JSON/);
      assert.equal((error as Error).cause instanceof Error, true);
      return true;
    },
  );
});


test("preserves fallback fields and deduplicates unit ids", () => {
  const result = parseDaftPage(
    {
      props: {
        pageProps: {
          listings: [
            {
              listing: {
                id: 303,
                title: "Listing Title",
                price: "TBC",
                numBedrooms: "12 Bed",
                propertyType: "Semi",
                newHome: { subUnits: [] },
              },
            },
            {
              listing: {
                id: 304,
                newHome: {
                  subUnits: [
                    {
                      id: 305,
                      price: "€300,000",
                      numBedrooms: " 2 Bed ",
                      numBathrooms: "1 Bath",
                      propertyType: "  Flat ",
                    },
                  ],
                },
              },
            },
            {
              listing: {
                id: 306,
                newHome: {
                  developmentName: "Duplicate Development",
                  subUnits: [{ id: 305, price: "€1" }],
                },
              },
            },
          ],
          paging: { currentPage: 2, totalPages: 2, totalResults: "3" },
        },
      },
    },
    "https://www.daft.ie",
  );
  assert.equal(result.currentPage, 2);
  assert.equal(result.totalPages, 2);
  assert.equal(result.totalResults, 3);
  assert.equal(result.findings.length, 2);
  assert.deepEqual(result.findings[0], {
    id: "303",
    title: "Listing Title",
    developmentTitle: "Listing Title",
    priceText: "TBC",
    priceEur: undefined,
    bedrooms: 12,
    propertyType: "Semi",
    url: "https://www.daft.ie/new-home-for-sale/listing/303",
    publishedAt: undefined,
    source: "development",
  });
  assert.equal(result.findings[1].title, "Daft development 304 — 2 Bed · 1 Bath · Flat");
  assert.equal(result.findings[1].url, "https://www.daft.ie/new-home-for-sale/listing/305");
});


test("handles missing parent data and custom fallback paths", () => {
  const result = parseDaftPage(
    {
      props: {
        pageProps: {
          listings: [
            {
              listing: {
                id: 307,
                title: "  Trimmed Parent  ",
                newHome: {
                  subUnits: [
                    {
                      id: 308,
                      price: "€2",
                      numBedrooms: " ",
                    },
                  ],
                },
              },
            },
            {
              listing: {
                id: "309",
                title: "Custom Path Development",
                price: "€3",
                seoFriendlyPath: "/custom/path/309",
                numBedrooms: "12 Bed",
                propertyType: "Flat",
                newHome: { subUnits: [] },
              },
            },
            {
              listing: {
                id: "310",
                title: "Missing New Home",
                publishDate: " ",
              },
            },
            {
              listing: {
                id: 311,
                title: " ",
              },
            },
          ],
        },
      },
    },
    "https://www.daft.ie",
  );
  assert.equal(result.findings.length, 4);
  assert.equal(result.findings[0].title, "Trimmed Parent");
  assert.equal(result.findings[0].priceText, "€2");
  assert.equal(result.findings[0].bedrooms, undefined);
  assert.equal(result.findings[1].url, "https://www.daft.ie/custom/path/309");
  assert.equal(result.findings[1].bedrooms, 12);
  assert.equal(result.findings[1].propertyType, "Flat");
  assert.equal(result.findings[2].title, "Missing New Home");
  assert.equal(result.findings[2].url, "https://www.daft.ie/new-home-for-sale/listing/310");
  assert.equal(result.findings[2].publishedAt, undefined);
  assert.equal(result.findings[3].title, "Daft development 311");
});

test("extracts Next data from the rendered HTML shell", () => {
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></html>`;
  assert.deepEqual(parseNextDataScript(html), payload);
  assert.throws(() => parseNextDataScript("<html></html>"), /did not contain/);
});
