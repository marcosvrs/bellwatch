import assert from "node:assert/strict";
import test from "node:test";
import { parseDaftListingDetails, parseDaftPage } from "../src/daft/parser.js";

const payload = {
  props: {
    pageProps: {
      listings: [
        {
          listing: {
            id: 100,
            title: "Example Development, Dublin",
            price: "From €300,000",
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
      paging: { currentPage: 1, totalPages: 2 },
    },
  },
};

test("parses detail-page scheme evidence", () => {
  assert.deepEqual(
    parseDaftListingDetails({
      props: {
        pageProps: {
          listing: {
            title: "Example home",
            newHome: { tagLine: "Starter Home Purchase Scheme" },
            description: "Local-authority equity share.",
          },
        },
      },
    }),
    {
      schemeText:
        "Example home\nStarter Home Purchase Scheme\nLocal-authority equity share.",
    },
  );
  assert.deepEqual(
    parseDaftListingDetails({
      props: { pageProps: { listing: { title: "No description" } } },
    }),
    { schemeText: undefined },
  );
  assert.deepEqual(parseDaftListingDetails(null), {
    schemeText: undefined,
  });
});

test("parses matching fields from detail pages", () => {
  assert.deepEqual(
    parseDaftListingDetails({
      props: {
        pageProps: {
          listing: {
            floorArea: { value: "105", unit: "METRES_SQUARED" },
            ber: { rating: "B2" },
            addressDetails: {
              postalCode: "A12B345",
              streetAddress: "1 Example Road",
            },
          },
        },
      },
    }),
    {
      floorSizeSqm: 105,
      berRating: "B2",
      address: "1 Example Road",
      eircode: "A12B345",
    },
  );
});

test("parses unit findings and development fallbacks", () => {
  const result = parseDaftPage(payload, "https://www.daft.ie");
  assert.equal(result.currentPage, 1);
  assert.equal(result.totalPages, 2);
  assert.equal(result.findings.length, 2);
  assert.deepEqual(result.findings[0], {
    id: "101",
    title: "Example Development — 3 Bed · 2 Bath · Terrace",
    developmentTitle: "Example Development",
    priceText: "€315,000",
    bedrooms: 3,
    bathrooms: 2,
    propertyType: "Terrace",
    url: "https://www.daft.ie/new-home-for-sale/3-bed-example/101",
  });
  assert.equal(result.findings[1].id, "200");
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
  assert.equal(result.findings[0].priceText, "Price unavailable");
  assert.equal(result.findings[1].id, "302");
  assert.equal(result.findings[1].title, "Daft development 302");
  assert.equal(result.findings[1].priceText, "Price unavailable");
  assert.deepEqual(parseDaftPage(null, "https://www.daft.ie"), {
    findings: [],
    currentPage: 1,
    totalPages: 1,
  });
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
          paging: { currentPage: 2, totalPages: 2 },
        },
      },
    },
    "https://www.daft.ie",
  );
  assert.equal(result.currentPage, 2);
  assert.equal(result.totalPages, 2);
  assert.equal(result.findings.length, 2);
  assert.deepEqual(result.findings[0], {
    id: "303",
    title: "Listing Title",
    developmentTitle: "Listing Title",
    priceText: "TBC",
    bedrooms: 12,
    propertyType: "Semi",
    url: "https://www.daft.ie/new-home-for-sale/listing/303",
  });
  assert.equal(result.findings[1].title, "Daft development 304 — 2 Bed · 1 Bath · Flat");
  assert.equal(result.findings[1].url, "https://www.daft.ie/new-home-for-sale/listing/305");
});
test("parses direct sale and rental listings by section", () => {
  const sale = parseDaftPage(
    {
      props: {
        pageProps: {
          listings: [
            {
              listing: {
                id: 400,
                title: "Apartment 3, Dublin 2",
                price: "€495,000",
                numBedrooms: "2 Bed",
                numBathrooms: "2 Bath",
                propertyType: "Apartment",
                seoFriendlyPath: "/for-sale/apartment-3-dublin-2/400",
              },
            },
          ],
          paging: { currentPage: 1, totalPages: 1 },
        },
      },
    },
    "https://www.daft.ie",
    "property-for-sale",
  );
  assert.deepEqual(sale.findings, [
    {
      id: "400",
      title: "Apartment 3, Dublin 2",
      developmentTitle: "Apartment 3, Dublin 2",
      priceText: "€495,000",
      bedrooms: 2,
      bathrooms: 2,
      propertyType: "Apartment",
      url: "https://www.daft.ie/for-sale/apartment-3-dublin-2/400",
    },
  ]);

  const directRent = parseDaftPage(
    {
      props: {
        pageProps: {
          listings: [
            {
              listing: {
                id: 500,
                title: "12 Main Street, Dublin 8",
                price: "€1,800 per month",
                numBedrooms: "2 Bed",
                numBathrooms: "1 Bath",
                propertyType: "Apartment",
                seoFriendlyPath: "/for-rent/12-main-street-dublin-8/500",
              },
            },
          ],
        },
      },
    },
    "https://www.daft.ie",
    "property-for-rent",
  );
  assert.equal(directRent.findings[0].id, "500");
  assert.equal(directRent.findings[0].priceText, "€1,800 per month");
  assert.equal(directRent.findings[0].bathrooms, 1);
  assert.equal(directRent.findings[0].url, "https://www.daft.ie/for-rent/12-main-street-dublin-8/500");

  const prsRent = parseDaftPage(
    {
      props: {
        pageProps: {
          listings: [
            {
              listing: {
                id: 600,
                title: "Riverside Apartments",
                prs: {
                  subUnits: [
                    {
                      id: 601,
                      price: "€2,700 per month",
                      numBedrooms: "1 Bed",
                      numBathrooms: "1 Bath",
                      propertyType: "Apartment",
                      seoFriendlyPath: "/for-rent/riverside-apartments/601",
                    },
                    {
                      id: 602,
                      price: "€3,000 per month",
                      numBedrooms: "2 Bed",
                      numBathrooms: "2 Bath",
                      propertyType: "Apartment",
                      seoFriendlyPath: "/for-rent/riverside-apartments/602",
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
    "https://www.daft.ie",
    "property-for-rent",
  );
  assert.deepEqual(
    prsRent.findings.map(({ id, title, developmentTitle, priceText }) => ({
      id,
      title,
      developmentTitle,
      priceText,
    })),
    [
      {
        id: "601",
        title: "Riverside Apartments — 1 Bed · 1 Bath · Apartment",
        developmentTitle: "Riverside Apartments",
        priceText: "€2,700 per month",
      },
      {
        id: "602",
        title: "Riverside Apartments — 2 Bed · 2 Bath · Apartment",
        developmentTitle: "Riverside Apartments",
        priceText: "€3,000 per month",
      },
    ],
  );
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
  assert.equal(result.findings[3].title, "Daft development 311");
});
test("rejects invalid records and preserves numeric paging", () => {
  const arrayPayload = Object.assign([], {
    props: {
      pageProps: {
        listings: [
          {
            listing: {
              id: 999,
              title: "Array root must be ignored",
            },
          },
        ],
      },
    },
  });
  assert.deepEqual(parseDaftPage(arrayPayload, "https://www.daft.ie"), {
    findings: [],
    currentPage: 1,
    totalPages: 1,
  });

  const result = parseDaftPage(
    {
      props: {
        pageProps: {
          listings: [
            { listing: { id: NaN, title: "Not finite" } },
            { listing: { id: "   ", title: "Blank id" } },
            {
              listing: {
                id: " 412 ",
                title: "Valid string id",
                newHome: { subUnits: [] },
              },
            },
          ],
          paging: { currentPage: 2, totalPages: 3 },
        },
      },
    },
    "https://www.daft.ie",
  );
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].id, "412");
  assert.equal(result.currentPage, 2);
  assert.equal(result.totalPages, 3);
});

test("omits blank detail fields from scheme evidence", () => {
  assert.deepEqual(
    parseDaftListingDetails({
      listing: {
        title: " ",
        newHome: { tagLine: 42 },
        description: "Description only",
      },
    }),
    { schemeText: "Description only" },
  );
});

test("parses comparable fields from direct sale listings", () => {
  const result = parseDaftPage(
    {
      props: {
        pageProps: {
          listings: [
            {
              listing: {
                id: 510,
                title: "Semi-detached home",
                price: "€500,000",
                numBedrooms: "3 Bed",
                numBathrooms: "2 Bath",
                propertyType: "Semi-D",
                floorArea: { value: "105", unit: "METRES_SQUARED" },
                ber: { rating: "B2" },
                addressDetails: {
                  postalCode: "A12B345",
                  streetAddress: "1 Example Road",
                },
                seoFriendlyPath: "/for-sale/semi-detached-home/510",
              },
            },
          ],
        },
      },
    },
    "https://www.daft.ie",
    "property-for-sale",
  );

  assert.deepEqual(result.findings[0], {
    id: "510",
    title: "Semi-detached home",
    developmentTitle: "Semi-detached home",
    priceText: "€500,000",
    bedrooms: 3,
    bathrooms: 2,
    propertyType: "Semi-D",
    floorSizeSqm: 105,
    berRating: "B2",
    address: "1 Example Road",
    eircode: "A12B345",
    url: "https://www.daft.ie/for-sale/semi-detached-home/510",
  });
});

test("rejects arrays and non-finite numeric identifiers at every nesting level", () => {
  const functionPayload = Object.assign(
    () => undefined,
    {
      props: {
        pageProps: {
          listings: [{ listing: { id: 998, title: "Function root" } }],
        },
      },
    },
  );
  assert.deepEqual(parseDaftPage(functionPayload, "https://www.daft.ie"), {
    findings: [],
    currentPage: 1,
    totalPages: 1,
  });

  const arrayProps = Object.assign([], {
    pageProps: {
      listings: [{ listing: { id: 995, title: "Array props" } }],
    },
  });
  assert.deepEqual(
    parseDaftPage(
      { props: arrayProps },
      "https://www.daft.ie",
    ),
    {
      findings: [],
      currentPage: 1,
      totalPages: 1,
    },
  );
  const arrayPageProps = Object.assign([], {
    listings: [{ listing: { id: 994, title: "Array page props" } }],
  });
  assert.deepEqual(
    parseDaftPage(
      { props: { pageProps: arrayPageProps } },
      "https://www.daft.ie",
    ),
    {
      findings: [],
      currentPage: 1,
      totalPages: 1,
    },
  );
  const arrayNewHome = Object.assign([], {
    developmentName: "Array development",
    subUnits: [{ id: 997 }],
  });
  const arrayResult = parseDaftPage(
    {
      props: {
        pageProps: {
          listings: [
            {
              listing: {
                id: 996,
                title: "Parent development",
                newHome: arrayNewHome,
              },
            },
          ],
        },
      },
    },
    "https://www.daft.ie",
  );
  assert.equal(arrayResult.findings.length, 1);
  assert.equal(arrayResult.findings[0].id, "996");
  assert.equal(arrayResult.findings[0].title, "Parent development");

  const invalidResult = parseDaftPage(
    {
      props: {
        pageProps: {
          listings: [
            { listing: { id: Infinity } },
            { listing: { id: -Infinity } },
          ],
          paging: { currentPage: NaN, totalPages: Infinity },
        },
      },
    },
    "https://www.daft.ie",
  );
  assert.deepEqual(invalidResult, {
    findings: [],
    currentPage: 1,
    totalPages: 1,
  });
});
