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

test("extracts Next data from the rendered HTML shell", () => {
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></html>`;
  assert.deepEqual(parseNextDataScript(html), payload);
  assert.throws(() => parseNextDataScript("<html></html>"), /did not contain/);
});
