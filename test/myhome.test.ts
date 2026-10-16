import assert from "node:assert/strict";
import test from "node:test";
import { DAFT_FACILITIES, type DaftFilters } from "../src/daft/filters.js";
import type { SourcedListing } from "../src/listings.js";
import { classifyShpsAvailability, filterShpsFindings } from "../src/daft/shps.js";
import {
  type MyHomeDetail,
  type MyHomeFinding,
  enrichMyHomeFinding,
  parseMyHomeDetailPage,
  parseMyHomeListPage,
} from "../src/myhome/listings.js";
import {
  buildMyHomeSearchUrl,
  getMyHomeNationalSearchPath,
  parseMyHomeRegionRoutes,
  resolveMyHomeSearchPath,
  validateMyHomeFilterSupport,
} from "../src/myhome/search.js";
import { buildMyHomeUrl } from "../src/myhome/urls.js";

const BASE_URL = "https://www.myhome.ie";
const SEARCH_URL = `${BASE_URL}/residential/ireland/new-homes/property-for-sale`;
const EMPTY_FILTERS: DaftFilters = {
  propertyTypes: [],
  mediaTypes: [],
  availability: "published",
  facilities: [],
};

interface DetailOptions {
  readonly id?: string | undefined;
  readonly propertyType?: string | undefined;
  readonly price?: string | undefined;
  readonly bedrooms?: string | undefined;
  readonly bathrooms?: string | undefined;
  readonly floorArea?: string | undefined;
  readonly ber?: string | undefined;
  readonly availability?: string | undefined;
  readonly publishedAt?: string | undefined;
  readonly openViewing?: string | undefined;
  readonly saleType?: string | undefined;
  readonly onlineOffers?: string | undefined;
  readonly leaseLength?: string | undefined;
  readonly furnishing?: string | undefined;
  readonly features?: readonly string[] | undefined;
  readonly title?: string | undefined;
  readonly development?: string | undefined;
  readonly address?: string | undefined;
  readonly eircode?: string | undefined;
  readonly schemeText?: string | undefined;
  readonly latitude?: string | undefined;
  readonly longitude?: string | undefined;
}

const detailHtml = (options: DetailOptions = {}): string => {
  const rows = [
    options.propertyType === undefined ? "" : `<dt>Property Type</dt><dd>${options.propertyType}</dd>`,
    options.price === undefined ? "" : `<dt>Price</dt><dd>${options.price}</dd>`,
    options.bedrooms === undefined ? "" : `<dt>Bedrooms</dt><dd>${options.bedrooms}</dd>`,
    options.bathrooms === undefined ? "" : `<dt>Bathrooms</dt><dd>${options.bathrooms}</dd>`,
    options.floorArea === undefined ? "" : `<dt>Floor area</dt><dd>${options.floorArea}</dd>`,
    options.ber === undefined ? "" : `<dt>BER rating</dt><dd>${options.ber}</dd>`,
    options.availability === undefined ? "" : `<dt>Availability</dt><dd>${options.availability}</dd>`,
    options.publishedAt === undefined ? "" : `<dt>Date published</dt><dd>${options.publishedAt}</dd>`,
    options.saleType === undefined ? "" : `<dt>Sale type</dt><dd>${options.saleType}</dd>`,
    options.onlineOffers === undefined ? "" : `<dt>Online offers</dt><dd>${options.onlineOffers}</dd>`,
    options.leaseLength === undefined ? "" : `<dt>Lease length</dt><dd>${options.leaseLength}</dd>`,
    options.furnishing === undefined ? "" : `<dt>Furnishing</dt><dd>${options.furnishing}</dd>`,
    options.address === undefined ? "" : `<dt>Address</dt><dd>${options.address}</dd>`,
    options.eircode === undefined ? "" : `<dt>Eircode</dt><dd>${options.eircode}</dd>`,
  ].join("");
  const viewing = options.openViewing === undefined
    ? ""
    : `<section class="open-viewings"><h2>Open Viewings</h2><time datetime="${options.openViewing}">${options.openViewing}</time></section>`;
  const features = options.features === undefined
    ? ""
    : `<section class="features"><h2>Features</h2><ul>${options.features.map((feature) => `<li>${feature}</li>`).join("")}</ul></section>`;
  const coordinates = options.latitude === undefined && options.longitude === undefined
    ? ""
    : `<div data-latitude="${options.latitude ?? ""}" data-longitude="${options.longitude ?? ""}"></div>`;
  const schemeText = options.schemeText ?? "";
  const development = options.development === undefined
    ? ""
    : `<span data-testid="development-title">${options.development}</span>`;
  return `<html><body><main><h1>${options.title ?? "Harbour View House"}</h1>${development}<dl>${rows}</dl>${viewing}${features}${coordinates}<p>${schemeText}</p></main></body></html>`;
};

const checkedFirst = <T>(values: readonly T[]): T => {
  const value = values[0];
  if (value === undefined) { throw new Error("Expected one result"); }
  return value;
};

const findingFrom = (options: DetailOptions = {}): MyHomeFinding => {
  const sourceId = options.id ?? "12345678";
  const list = parseMyHomeListPage(
    `<main><article><a href="/residential/harbour-view/${sourceId}">Harbour View</a></article></main>`,
    SEARCH_URL,
  );
  const candidate = checkedFirst(list.findings);
  const details = parseMyHomeDetailPage(detailHtml({
    propertyType: "House",
    price: "€520,000",
    bedrooms: "3",
    bathrooms: "2",
    floorArea: "100 sqm",
    ber: "C",
    availability: "For Sale",
    publishedAt: "2026-09-30",
    openViewing: "2026-10-15",
    saleType: "Auction",
    onlineOffers: "Yes",
    leaseLength: "12 months",
    furnishing: "Furnished",
    features: ["Alarm", "Parking"],
    ...options,
  }), candidate.facts.url);
  return enrichMyHomeFinding(candidate, details);
};


test("builds canonical URLs and provider-native search queries", () => {
  assert.equal(
    buildMyHomeUrl(BASE_URL, "/residential/ireland/new-homes/property-for-sale/"),
    `${BASE_URL}/residential/ireland/new-homes/property-for-sale`,
  );
  assert.equal(
    buildMyHomeUrl(BASE_URL, "/residential/ireland/new-homes/property-for-sale", 4),
    `${BASE_URL}/residential/ireland/new-homes/property-for-sale?page=4`,
  );
  assert.equal(
    buildMyHomeUrl(BASE_URL, "/rentals/ireland/property-to-rent", 2),
    `${BASE_URL}/rentals/ireland/property-to-rent?page=2`,
  );

  assert.equal(
    buildMyHomeUrl(
      "https://homes.example/root/path///?stale=1",
      "/residential/ireland/property-for-sale",
      2,
    ),
    "https://homes.example/root/path/residential/ireland/property-for-sale?page=2",
  );
  assert.equal(
    buildMyHomeUrl("https://homes.example/", "/rentals/ireland/property-to-rent"),
    "https://homes.example/rentals/ireland/property-to-rent",
  );
  const searchUrl = new URL(buildMyHomeSearchUrl(
    BASE_URL,
    "/residential/dublin/property-for-sale",
    "property-for-sale",
    {
      ...EMPTY_FILTERS,
      priceMinEur: 300_000,
      priceMaxEur: 500_000,
      bedsMin: 3,
      bathsMin: 2,
      bathsMax: 4,
      floorSizeMinSqm: 90,
      keyword: "harbour view",
      propertyTypes: ["detached-houses", "terraced-houses"],
    },
    3,
  ));
  assert.equal(searchUrl.searchParams.get("minprice"), "300000");
  assert.equal(searchUrl.searchParams.get("maxprice"), "500000");
  assert.equal(searchUrl.searchParams.get("minbeds"), "3");
  assert.equal(searchUrl.searchParams.get("minbathrooms"), "2");
  assert.equal(searchUrl.searchParams.has("maxbaths"), false);
  assert.equal(searchUrl.searchParams.get("minsize"), "90");
  assert.equal(searchUrl.searchParams.get("query"), "harbour view");
  assert.deepEqual(searchUrl.searchParams.getAll("propertytypeids"), ["39", "37"]);
  assert.equal(searchUrl.searchParams.get("page"), "3");
  const partiallyUnsupported = new URL(buildMyHomeSearchUrl(
    BASE_URL,
    "/residential/dublin/new-homes/property-for-sale",
    "new-homes-for-sale",
    { ...EMPTY_FILTERS, radiusKm: 20, addedInLastDays: 1, bedsMin: 3 },
  ));
  assert.equal(partiallyUnsupported.searchParams.get("minbeds"), "3");
  assert.equal(partiallyUnsupported.searchParams.has("radius"), false);
  assert.equal(partiallyUnsupported.searchParams.has("firstPublishDate"), false);
  assert.equal(
    validateMyHomeFilterSupport("new-homes-for-sale", {
      ...EMPTY_FILTERS,
      radiusKm: 20,
      addedInLastDays: 1,
      bedsMin: 3,
    }).filterSources.bedsMin,
    "native",
  );
  assert.deepEqual(
    validateMyHomeFilterSupport("new-homes-for-sale", {
      ...EMPTY_FILTERS,
      radiusKm: 20,
      addedInLastDays: 1,
      bedsMin: 3,
    }).unsupportedFilters,
    ["radiusKm", "addedInLastDays"],
  );
  const mixedPropertyTypes = new URL(buildMyHomeSearchUrl(
    BASE_URL,
    "/residential/ireland/new-homes/property-for-sale",
    "new-homes-for-sale",
    { ...EMPTY_FILTERS, propertyTypes: ["houses", "duplexes"] },
  ));
  assert.deepEqual(mixedPropertyTypes.searchParams.getAll("propertytypeids"), []);
  assert.equal(
    buildMyHomeUrl("https://homes.example/root/path///?stale=1", "/residential/ireland/property-for-sale", 2),
    "https://homes.example/root/path/residential/ireland/property-for-sale?page=2",
  );
  assert.equal(
    buildMyHomeUrl("https://homes.example/", "/rentals/ireland/property-to-rent"),
    "https://homes.example/rentals/ireland/property-to-rent",
  );
  assert.throws(
    () => buildMyHomeUrl("https://homes.example/root", "https://attacker.example/residential/home/12345"),
    /origin/,
  );
  assert.throws(() => buildMyHomeUrl(BASE_URL, "/residential/search?beds=3"), /canonical/);
  assert.throws(() => buildMyHomeUrl(BASE_URL, "/residential/search#results"), /canonical/);
  assert.throws(() => buildMyHomeUrl(BASE_URL, "https://attacker.example/residential/search"), /origin/);
  assert.throws(() => buildMyHomeUrl(BASE_URL, "/search"), /canonical/);
  assert.throws(() => buildMyHomeUrl(BASE_URL, "/residential/search", 0), /positive integer/);
  const credentialedBase = new URL(BASE_URL);
  credentialedBase.username = "test-user";
  credentialedBase.password = "test-password";
  assert.throws(
    () => buildMyHomeUrl(credentialedBase.toString(), "/residential/search"),
    /credentials/,
  );
});

test("parses canonical list cards, keeps raw source IDs, and deduplicates responsive duplicates", () => {
  const result = parseMyHomeListPage(
    `<main>
      <article><a href="/residential/harbour-view/001234">Harbour View</a><span>3 bed house from €450,000</span></article>
      <div class="mobile-card"><a href="/residential/harbour-view/001234"><img alt="Harbour View"></a></div>
      <a href="?page=2">2</a><a href="?page=8">8</a>
      <a href="?page=9&beds=3">9</a><a href="https://other.example/residential/house/998877">Other</a>
      <a href="/residential/ireland/property-for-sale">Browse all</a>
      <nav><a href="/residential/ordinary-navigation/12345">Residential navigation</a></nav>
      <article><a href="/residential/estate-agent/12346">Estate agent profile</a></article>
      <article><a href="/residential/harbour-view/details">Non-listing detail link</a></article>
      <article><a href="/residential/agents/jane-doe/12347">Agent profile</a></article>
    </main>`,
    `${SEARCH_URL}?page=2`,
  );
  assert.equal(result.currentPage, 2);
  assert.equal(result.totalPages, 9);
  assert.equal(result.findings.length, 1);
  const finding = checkedFirst(result.findings);
  assert.equal(finding.source, "myhome");
  assert.equal(finding.sourceId, "001234");
  assert.equal(finding.facts.url, `${BASE_URL}/residential/harbour-view/001234`);
  assert.equal(finding.facts.bedrooms, undefined);
  assert.equal(finding.facts.propertyType, undefined);
  assert.equal(finding.facts.priceText, "Price unavailable");
  assert.equal(finding.myhomeEvidence.typeVerified, false);
  const filteredQueryPage = parseMyHomeListPage("", `${SEARCH_URL}?page=2&minbeds=3`);
  assert.equal(filteredQueryPage.currentPage, 2);
  assert.throws(() => parseMyHomeListPage("", `${SEARCH_URL}?page=1e6`), /positive decimal/);
  assert.throws(() => parseMyHomeListPage("", `${SEARCH_URL}?page=0x100`), /positive decimal/);
  assert.throws(() => parseMyHomeListPage("", "https://www.myhome.ie/search"), /canonical/);
});

test("preserves configured base paths when parsing listing-card URLs", () => {
  const page = parseMyHomeListPage(
    `<main><article><a href="/residential/harbour-view/12345">Harbour View</a></article></main>`,
    "https://homes.example/root/residential/ireland/property-for-sale",
  );
  const candidate = checkedFirst(page.findings);
  assert.equal(
    candidate.facts.url,
    "https://homes.example/root/residential/harbour-view/12345",
  );
  const detail = parseMyHomeDetailPage(
    detailHtml({ propertyType: "House" }),
    candidate.facts.url,
  );
  assert.equal(detail.url, candidate.facts.url);
});

test("parses and enriches rental listings under canonical rentals routes", () => {
  const rentalUrl = `${BASE_URL}/rentals/ireland/property-to-rent`;
  const candidate = checkedFirst(parseMyHomeListPage(
    `<main><article><a href="/rentals/brochure/house-on-the-green/90006">House on the Green</a></article></main>`,
    rentalUrl,
  ).findings);
  assert.equal(candidate.facts.url, `${BASE_URL}/rentals/brochure/house-on-the-green/90006`);
  const detail = parseMyHomeDetailPage(detailHtml({
    propertyType: "Semi-Detached House",
    price: "€2,500",
    bedrooms: "3",
    bathrooms: "2",
    availability: "Available",
    leaseLength: "12 months",
    furnishing: "Furnished",
    features: ["Parking"],
  }), candidate.facts.url);
  const rental = enrichMyHomeFinding(candidate, detail);
  assert.equal(rental.sourceId, "90006");
  assert.equal(rental.facts.propertyType, "Semi-detached house");
});

test("maps rental availability labels from MyHome details", () => {
  const rentalSearch = `${BASE_URL}/rentals/ireland/property-to-rent`;
  const labels = [
    { label: "To Let", availability: "published" },
    { label: "To Rent", availability: "published" },
    { label: "Let Agreed", availability: "sale-agreed" },
  ] as const;
  for (const [index, { label, availability }] of labels.entries()) {
    const sourceId = String(90010 + index);
    const candidate = checkedFirst(parseMyHomeListPage(
      `<main><article><a href="/rentals/brochure/rental-home/${sourceId}">Rental Home</a></article></main>`,
      rentalSearch,
    ).findings);
    const rental = enrichMyHomeFinding(candidate, parseMyHomeDetailPage(
      detailHtml({ propertyType: "House", availability: label }),
      candidate.facts.url,
    ));
    assert.equal(rental.myhomeEvidence.availability, availability);
  }
});

test("derives total pages from MyHome result-count metadata and rel-next links", () => {
  const page = parseMyHomeListPage(
    `<head><link rel="next" href="?page=2">
      <meta name="description" content="Listings 1-20 (out of 345) for Ireland property for sale.">
    </head><main></main>`,
    SEARCH_URL,
  );
  assert.equal(page.currentPage, 1);
  assert.equal(page.totalPages, 18);
  const lastPage = parseMyHomeListPage(
    `<meta name="description" content="Listings 341-345 (out of 345) for Ireland property for sale.">`,
    `${SEARCH_URL}?page=18`,
  );
  assert.equal(lastPage.currentPage, 18);
  assert.equal(lastPage.totalPages, 18);
});

test("resolves nationwide scope and only exact RegionUrls-backed locations", () => {
  const regionRoutes = parseMyHomeRegionRoutes(
    `<script id="ng-state" type="application/json">{"bootstrap":[{"ignored":null,"RegionUrls":{
      "1265":"/residential/dublin/new-homes/house-for-sale",
      "1266":"/residential/dublin/house-for-sale",
      "1267":"/rentals/dublin/house-to-rent",
      "1268":"/residential/cork/new-homes/house-for-sale",
      "1269":"/neighbourhood-guide/dublin",
      "1270":"https://attacker.example/residential/dublin/house-for-sale",
      "1271":17,
      "1272":"/residential/../rentals/dublin/house-to-rent"
    }}]}</script>`,
  );
  assert.deepEqual(regionRoutes, [
    "/residential/dublin/new-homes/house-for-sale",
    "/residential/dublin/house-for-sale",
    "/rentals/dublin/house-to-rent",
    "/residential/cork/new-homes/house-for-sale",
  ]);
  const saleAgreedRoutes = parseMyHomeRegionRoutes(
    `<script id="ng-state" type="application/json">` +
    `{"bootstrap":[{"RegionUrls":{"1":"/residential/dublin/sale-agreed-house"}}]}` +
    `</script>`,
  );
  assert.deepEqual(parseMyHomeRegionRoutes(`<script id="ng-state">{bad JSON}</script>`), []);
  assert.deepEqual(parseMyHomeRegionRoutes(""), []);

  const national = resolveMyHomeSearchPath("new-homes-for-sale", [], EMPTY_FILTERS, []);
  assert.equal(national.searchPath, "/residential/ireland/new-homes/property-for-sale");
  assert.deepEqual(national.unsupportedLocationFilters, []);

  assert.deepEqual(
    resolveMyHomeSearchPath(
      "new-homes-for-sale",
      [],
      { ...EMPTY_FILTERS, radiusKm: 20 },
      [],
    ),
    {
      searchPath: "/residential/ireland/new-homes/property-for-sale",
      unsupportedLocationFilters: ["radiusKm"],
    },
  );
  assert.equal(
    resolveMyHomeSearchPath("property-for-rent", [], EMPTY_FILTERS, []).searchPath,
    "/rentals/ireland/property-to-rent",
  );
  const houseFilters: DaftFilters = { ...EMPTY_FILTERS, propertyTypes: ["houses"] };
  const saleAgreedFilters: DaftFilters = {
    ...houseFilters,
    availability: "sale-agreed",
  };
  assert.equal(
    getMyHomeNationalSearchPath("property-for-sale", "sale-agreed"),
    "/residential/ireland/sale-agreed-property",
  );
  assert.equal(
    resolveMyHomeSearchPath(
      "property-for-sale",
      ["dublin"],
      saleAgreedFilters,
      saleAgreedRoutes,
    ).searchPath,
    "/residential/dublin/sale-agreed-house",
  );
  assert.equal(
    validateMyHomeFilterSupport("property-for-sale", saleAgreedFilters)
      .filterSources.availability,
    "native",
  );
  const regionalNewHomes = resolveMyHomeSearchPath(
    "new-homes-for-sale",
    ["dublin"],
    houseFilters,
    regionRoutes,
  );
  assert.equal(regionalNewHomes.searchPath, "/residential/dublin/new-homes/house-for-sale");
  assert.deepEqual(regionalNewHomes.unsupportedLocationFilters, []);
  assert.deepEqual(
    resolveMyHomeSearchPath("new-homes-for-sale", ["dublin"], EMPTY_FILTERS, regionRoutes),
    { unsupportedLocationFilters: ["locations"] },
  );
  assert.deepEqual(
    resolveMyHomeSearchPath("new-homes-for-sale", ["not-confirmed"], houseFilters, regionRoutes),
    { unsupportedLocationFilters: ["locations"] },
  );
  assert.deepEqual(
    resolveMyHomeSearchPath("new-homes-for-sale", ["../dublin"], houseFilters, regionRoutes),
    { unsupportedLocationFilters: ["locations"] },
  );
  assert.deepEqual(
    resolveMyHomeSearchPath(
      "new-homes-for-sale",
      ["dublin"],
      { ...houseFilters, radiusKm: 20 },
      regionRoutes,
    ),
    {
      searchPath: "/residential/dublin/new-homes/house-for-sale",
      unsupportedLocationFilters: ["radiusKm"],
    },
  );
  assert.deepEqual(
    resolveMyHomeSearchPath("new-homes-for-sale", ["dublin", "cork"], houseFilters, regionRoutes),
    { unsupportedLocationFilters: ["locations"] },
  );
  assert.equal(
    resolveMyHomeSearchPath("property-for-sale", ["dublin"], houseFilters, regionRoutes).searchPath,
    "/residential/dublin/house-for-sale",
  );
  assert.equal(
    resolveMyHomeSearchPath("property-for-rent", ["dublin"], houseFilters, regionRoutes).searchPath,
    "/rentals/dublin/house-to-rent",
  );
});

test("decodes server-rendered HTML and rejects embedded non-content or pagination noise", () => {
  const page = parseMyHomeListPage(
    `<!doctype html><!-- responsive page --><script><a href="/residential/house/90000">ignored</a></script>
      <style>.card::before { content: "<a>"; }</style>
      <main>
        <article><a href="/residential/harbour-house/90001" title="&quot;Harbour&apos;s&quot; &euro; &#65; &#x42; &#0;" title="ignored">A &amp; B &lt; C &gt; D&nbsp;E</a></article>
        <article><a href="/residential/blank-card/90002"></a></article>
        <a href="#fragment">invalid detail</a>
      </main></unmatched>`,
    SEARCH_URL,
  );
  assert.deepEqual(page.findings.map((finding) => finding.sourceId), ["90001", "90002"]);
  assert.equal(checkedFirst(page.findings).facts.title, `"Harbour's" € A B &#0;`);
  assert.equal(page.findings[1]?.facts.title, "MyHome listing 90002");
  assert.throws(() => parseMyHomeListPage("", `${SEARCH_URL}#fragment`), /fragments/);

  const metaOnly = parseMyHomeDetailPage(
    `<meta property="og:title" content="Metadata House"><dl><dt>Property Type</dt><dd>House</dd></dl>`,
    `${BASE_URL}/residential/metadata-house/90003`,
  );
  assert.equal(metaOnly.title, "Metadata House");
  assert.equal(metaOnly.myhomeEvidence.typeVerified, true);
});

test("parses and enriches type-level detail facts without losing source identity", () => {
  const candidate = checkedFirst(parseMyHomeListPage(
    `<main><article><a href="/residential/harbour-view/12345678">Harbour View</a></article></main>`,
    SEARCH_URL,
  ).findings);
  const detail: MyHomeDetail = parseMyHomeDetailPage(detailHtml({
    propertyType: "Semi-Detached House",
    price: "€520,000",
    bedrooms: "3",
    bathrooms: "2",
    floorArea: "1,076 sq ft",
    ber: "C",
    availability: "For Sale",
    publishedAt: "2026-09-30",
    openViewing: "2026-10-15",
    saleType: "Auction",
    onlineOffers: "Yes",
    leaseLength: "12 months",
    furnishing: "Furnished",
    features: ["Alarm", "Parking"],
    title: "Harbour View, Semi-Detached House",
    development: "Harbour View",
    address: "Main Street, Dublin",
    eircode: "D01 AB12",
    schemeText: "Eligible for Help to Buy",
    latitude: "53.3498",
    longitude: "-6.2603",
  }), candidate.facts.url);
  const enriched = enrichMyHomeFinding(candidate, detail);
  assert.equal(detail.sourceId, "12345678");
  assert.equal(enriched.sourceId, "12345678");
  assert.equal(enriched.source, "myhome");
  assert.equal(enriched.facts.propertyType, "Semi-detached house");
  assert.equal(enriched.facts.bedrooms, 3);
  assert.equal(enriched.facts.bathrooms, 2);
  assert.equal(enriched.facts.priceText, "€520,000");
  assert.equal(enriched.myhomeEvidence.priceEur, 520_000);
  assert.equal(enriched.facts.floorSizeSqm, 99.96);
  assert.equal(enriched.facts.berRating, "C");
  assert.equal(enriched.facts.address, "Main Street, Dublin");
  assert.equal(enriched.facts.eircode, "D01 AB12");
  assert.match(enriched.facts.schemeText ?? "", /Help to Buy/);
  assert.equal(enriched.latitude, 53.3498);
  assert.equal(enriched.longitude, -6.2603);
  assert.equal(enriched.myhomeEvidence.availability, "published");
  assert.equal(enriched.myhomeEvidence.publishedAt, "2026-09-30T00:00:00.000Z");
  assert.deepEqual(enriched.myhomeEvidence.openViewingDates, ["2026-10-15"]);
  assert.deepEqual(enriched.myhomeEvidence.daftPropertyTypes, ["houses", "semi-detached-houses"]);
  assert.throws(() => enrichMyHomeFinding({
    source: "daft",
    sourceId: "12345678",
    facts: candidate.facts,
  }, detail), /Only MyHome/);
  assert.throws(() => enrichMyHomeFinding({
    ...candidate,
    sourceId: "wrong-id",
  }, detail), /does not match/);
});

test("preserves SHPS and LAAPS evidence for SHPS filtering with or without Help to Buy", () => {
  const shpsOnly = findingFrom({
    id: "24001",
    schemeText: "This development is available under SHPS for eligible buyers.",
  });
  assert.match(shpsOnly.facts.schemeText ?? "", /\bSHPS\b/);
  assert.equal(classifyShpsAvailability(shpsOnly.facts), "shps-only");
  assert.deepEqual(
    filterShpsFindings([shpsOnly.facts], { filter: "only" }),
    [shpsOnly.facts],
  );

  const shpsWithHtb = findingFrom({
    id: "24002",
    schemeText: "This development is available under LAAPS. Help to Buy funding may also be available.",
  });
  assert.match(shpsWithHtb.facts.schemeText ?? "", /\bLAAPS\b/);
  assert.match(shpsWithHtb.facts.schemeText ?? "", /\bHelp to Buy\b/);
  assert.equal(classifyShpsAvailability(shpsWithHtb.facts), "shps-and-other");
  assert.deepEqual(
    filterShpsFindings([shpsWithHtb.facts], { filter: "only" }),
    [],
  );
});

test("parses MyHome metric square units and source-linked property coordinates", () => {
  const detail = parseMyHomeDetailPage(
    `<main>
      <h1>House Type</h1>
      <dl><dt>Property Type</dt><dd>Semi-Detached House</dd><dt>Size</dt><dd>120 meters<sup>2</sup></dd></dl>
      <h2>Available to View</h2>
      <a href="https://www.google.com/maps/dir/?api=1&amp;destination=53.338901%2C-6.464207">Map</a>
      <a href="https://maps.example.com/maps/?destination=0%2C0">Untrusted Map</a>
      <a href="/residential/brochure/other-house/90005">Related listing</a>
    </main>`,
    `${BASE_URL}/residential/brochure/house-type/90004`,
  );
  assert.equal(detail.floorSizeSqm, 120);
  assert.equal(detail.latitude, 53.338901);
  assert.equal(detail.longitude, -6.464207);
  assert.equal(detail.myhomeEvidence.availability, "published");
});

test("does not turn development-wide aggregate values into type-level details", () => {
  const url = `${BASE_URL}/residential/harbour-view/12345678`;
  const aggregate = parseMyHomeDetailPage(
    `<main><h1>Harbour View Development</h1><div class="price">From €450,000</div><div class="bedrooms">3-4</div><div class="floor-area">100 sqm</div><div class="property-types">House, Apartment, Duplex</div></main>`,
    url,
  );
  assert.equal(aggregate.myhomeEvidence.typeVerified, false);
  assert.equal(aggregate.myhomeEvidence.priceEur, undefined);
  assert.equal(aggregate.priceText, "Price unavailable");
  assert.equal(aggregate.bedrooms, undefined);
  assert.equal(aggregate.propertyType, undefined);
  assert.equal(aggregate.floorSizeSqm, undefined);

  const staleCardFacts: SourcedListing = {
    source: "myhome",
    sourceId: "12345678",
    facts: {
      title: "Old aggregate title",
      developmentTitle: "Harbour View",
      priceText: "From €450,000",
      bedrooms: 4,
      bathrooms: 3,
      propertyType: "House",
      floorSizeSqm: 100,
      url,
    },
  };
  const enriched = enrichMyHomeFinding(staleCardFacts, aggregate);
  assert.equal(enriched.facts.priceText, "Price unavailable");
  assert.equal(enriched.facts.bedrooms, undefined);
  assert.equal(enriched.facts.bathrooms, undefined);
  assert.equal(enriched.facts.propertyType, undefined);
  assert.equal(enriched.facts.floorSizeSqm, undefined);
});
test("parses provider detail facts without applying local filter predicates", () => {
  const poa = findingFrom({ id: "10001", price: "POA" });
  assert.equal(poa.facts.priceText, "POA");
  assert.equal(poa.myhomeEvidence.priceState, "poa");
  assert.equal(poa.myhomeEvidence.priceEur, undefined);

  const malformed = findingFrom({ id: "10002", price: "€450,000 - €475,000" });
  assert.equal(malformed.myhomeEvidence.priceState, "unknown");
  assert.equal(malformed.myhomeEvidence.priceEur, undefined);

  const allFacilities = findingFrom({
    id: "21999",
    features: [
      "Alarm",
      "Cable Television",
      "Central Heating",
      "Dishwasher",
      "Tumble Dryer",
      "Garden",
      "Gas Fired Central Heating",
      "Internet",
      "Microwave",
      "Oil Fired Central Heating",
      "Parking",
      "Pets Allowed",
      "Serviced Property",
      "Smoking Allowed",
      "Washing Machine",
      "Wheelchair Access",
      "Wired for Cable Television",
    ],
  });
  assert.deepEqual(allFacilities.myhomeEvidence.facilities, DAFT_FACILITIES);

  for (const [id, grade, band] of [
    ["33001", "A2", "A"],
    ["33002", "B2", "B"],
    ["33003", "B3", "B"],
  ] as const) {
    assert.equal(findingFrom({ id, ber: grade }).facts.berRating, band);
  }
  assert.equal(findingFrom({ id: "33004", ber: "B4" }).facts.berRating, undefined);
});

test("reports native MyHome filter support without treating detail evidence as a filter", () => {
  const common = validateMyHomeFilterSupport("new-homes-for-sale", {
    ...EMPTY_FILTERS,
    radiusKm: 20,
    priceMinEur: 300_000,
    bedsMin: 3,
    propertyTypes: ["houses"],
    bathsMin: 2,
    bathsMax: 4,
    keyword: "harbour",
    mediaTypes: ["video"],
    openViewingsFrom: "2026-10-10",
    addedInLastDays: 7,
    sort: "bestMatch",
    facilities: ["alarm"],
  });
  assert.deepEqual(common.supportedFilters, [
    "priceMinEur",
    "bedsMin",
    "propertyTypes",
    "bathsMin",
    "keyword",
    "availability",
  ]);
  assert.deepEqual(common.unsupportedFilters, [
    "radiusKm",
    "bathsMax",
    "mediaTypes",
    "addedInLastDays",
    "sort",
    "openViewingsFrom",
    "facilities",
  ]);
  assert.equal(common.filterSources.priceMinEur, "native");
  assert.equal(common.filterSources.radiusKm, "unsupported");

  const saleScope = validateMyHomeFilterSupport("property-for-sale", {
    ...EMPTY_FILTERS,
    priceMaxEur: 500_000,
    floorSizeMinSqm: 90,
    berMin: "D",
    saleType: "auction",
    onlineOffers: false,
    facilities: ["gas-fired-central-heating"],
    availability: "published",
  });
  assert.deepEqual(saleScope.supportedFilters, [
    "priceMaxEur",
    "availability",
    "floorSizeMinSqm",
  ]);
  assert.deepEqual(saleScope.unsupportedFilters, [
    "berMin",
    "saleType",
    "onlineOffers",
    "facilities",
  ]);

  const rentScope = validateMyHomeFilterSupport("property-for-rent", {
    ...EMPTY_FILTERS,
    bedsMax: 4,
    leaseLengthMaxMonths: 24,
    furnishing: "furnished",
    facilities: ["pets-allowed"],
  });
  assert.deepEqual(rentScope.supportedFilters, ["bedsMax", "availability"]);
  assert.deepEqual(rentScope.unsupportedFilters, [
    "leaseLengthMaxMonths",
    "furnishing",
    "facilities",
  ]);
});
