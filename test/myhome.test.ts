import assert from "node:assert/strict";
import test from "node:test";
import { DAFT_ADDED_IN_LAST_DAYS, DAFT_FACILITIES, type DaftFilters } from "../src/daft/filters.js";
import type { DaftSectionPath } from "../src/daft/sections.js";
import type { SourcedFinding } from "../src/listings.js";
import { classifyShpsAvailability, filterShpsFindings } from "../src/daft/shps.js";
import {
  applyMyHomeFilters,
  buildMyHomeUrl,
  enrichMyHomeFinding,
  parseMyHomeDetailPage,
  parseMyHomeListPage,
  parseMyHomeRegionRoutes,
  resolveMyHomeSearchPath,
  validateMyHomeFilterSupport,
  type MyHomeDetail,
  type MyHomeFinding,
} from "../src/myhome.js";

const BASE_URL = "https://www.myhome.ie";
const SEARCH_URL = `${BASE_URL}/residential/ireland/new-homes/property-for-sale`;
const FIXED_NOW = new Date("2026-10-01T12:00:00.000Z");
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
  }), candidate.finding.url);
  return enrichMyHomeFinding(candidate, details);
};

const apply = (
  findings: readonly SourcedFinding[],
  updates: Partial<DaftFilters> = {},
  sectionPath: DaftSectionPath = "new-homes-for-sale",
) => applyMyHomeFilters(findings, sectionPath, { ...EMPTY_FILTERS, ...updates }, FIXED_NOW);

test("builds canonical residential and rental URLs with page-only pagination", () => {
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
  assert.equal(result.totalPages, 8);
  assert.equal(result.findings.length, 1);
  const finding = checkedFirst(result.findings);
  assert.equal(finding.source, "myhome");
  assert.equal(finding.sourceId, "001234");
  assert.equal(finding.finding.id, "myhome:001234");
  assert.equal(finding.finding.url, `${BASE_URL}/residential/harbour-view/001234`);
  assert.equal(finding.finding.bedrooms, undefined);
  assert.equal(finding.finding.propertyType, undefined);
  assert.equal(finding.finding.priceText, "Price unavailable");
  assert.equal(finding.myhomeEvidence.typeVerified, false);
  assert.throws(() => parseMyHomeListPage("", `${SEARCH_URL}?page=2&beds=3`), /single/);
  assert.throws(() => parseMyHomeListPage("", "https://www.myhome.ie/search"), /canonical/);
});

test("preserves configured base paths when parsing listing-card URLs", () => {
  const page = parseMyHomeListPage(
    `<main><article><a href="/residential/harbour-view/12345">Harbour View</a></article></main>`,
    "https://homes.example/root/residential/ireland/property-for-sale",
  );
  const candidate = checkedFirst(page.findings);
  assert.equal(
    candidate.finding.url,
    "https://homes.example/root/residential/harbour-view/12345",
  );
  const detail = parseMyHomeDetailPage(
    detailHtml({ propertyType: "House" }),
    candidate.finding.url,
  );
  assert.equal(detail.url, candidate.finding.url);
});

test("parses and filters rental listings under canonical rentals routes", () => {
  const rentalUrl = `${BASE_URL}/rentals/ireland/property-to-rent`;
  const candidate = checkedFirst(parseMyHomeListPage(
    `<main><article><a href="/rentals/brochure/house-on-the-green/90006">House on the Green</a></article></main>`,
    rentalUrl,
  ).findings);
  assert.equal(candidate.finding.url, `${BASE_URL}/rentals/brochure/house-on-the-green/90006`);
  const detail = parseMyHomeDetailPage(detailHtml({
    propertyType: "Semi-Detached House",
    price: "€2,500",
    bedrooms: "3",
    bathrooms: "2",
    availability: "Available",
    leaseLength: "12 months",
    furnishing: "Furnished",
    features: ["Parking"],
  }), candidate.finding.url);
  const rental = enrichMyHomeFinding(candidate, detail);
  assert.equal(rental.sourceId, "90006");
  assert.equal(rental.finding.propertyType, "Semi-detached house");
  assert.deepEqual(
    applyMyHomeFilters([rental], "property-for-rent", {
      ...EMPTY_FILTERS,
      bedsMin: 3,
      leaseLengthMinMonths: 12,
      furnishing: "furnished",
      facilities: ["parking"],
    }, FIXED_NOW).findings,
    [rental],
  );
});

test("maps rental availability labels through MyHome filters", () => {
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
      candidate.finding.url,
    ));
    assert.equal(rental.myhomeEvidence.availability, availability);
    assert.deepEqual(
      apply([rental], { availability }, "property-for-rent").findings,
      [rental],
    );
    assert.deepEqual(
      apply(
        [rental],
        { availability: availability === "published" ? "sale-agreed" : "published" },
        "property-for-rent",
      ).findings,
      [],
    );
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
    { unsupportedLocationFilters: ["radiusKm"] },
  );
  assert.equal(
    resolveMyHomeSearchPath("property-for-rent", [], EMPTY_FILTERS, []).searchPath,
    "/rentals/ireland/property-to-rent",
  );
  const houseFilters: DaftFilters = { ...EMPTY_FILTERS, propertyTypes: ["houses"] };
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
    { unsupportedLocationFilters: ["radiusKm"] },
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
  assert.equal(checkedFirst(page.findings).finding.title, `"Harbour's" € A B &#0;`);
  assert.equal(page.findings[1]?.finding.title, "MyHome listing 90002");
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
  }), candidate.finding.url);
  const enriched = enrichMyHomeFinding(candidate, detail);
  assert.equal(detail.sourceId, "12345678");
  assert.equal(enriched.sourceId, "12345678");
  assert.equal(enriched.source, "myhome");
  assert.equal(enriched.finding.id, "myhome:12345678");
  assert.equal(enriched.finding.propertyType, "Semi-detached house");
  assert.equal(enriched.finding.bedrooms, 3);
  assert.equal(enriched.finding.bathrooms, 2);
  assert.equal(enriched.finding.priceText, "€520,000");
  assert.equal(enriched.myhomeEvidence.priceEur, 520_000);
  assert.equal(enriched.finding.floorSizeSqm, 99.96);
  assert.equal(enriched.finding.berRating, "C");
  assert.equal(enriched.finding.address, "Main Street, Dublin");
  assert.equal(enriched.finding.eircode, "D01 AB12");
  assert.match(enriched.finding.schemeText ?? "", /Help to Buy/);
  assert.equal(enriched.latitude, 53.3498);
  assert.equal(enriched.longitude, -6.2603);
  assert.equal(enriched.myhomeEvidence.availability, "published");
  assert.equal(enriched.myhomeEvidence.publishedAt, "2026-09-30T00:00:00.000Z");
  assert.deepEqual(enriched.myhomeEvidence.openViewingDates, ["2026-10-15"]);
  assert.deepEqual(enriched.myhomeEvidence.daftPropertyTypes, ["houses", "semi-detached-houses"]);
  assert.throws(() => enrichMyHomeFinding({
    source: "daft",
    sourceId: "12345678",
    finding: candidate.finding,
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
  assert.match(shpsOnly.finding.schemeText ?? "", /\bSHPS\b/);
  assert.equal(classifyShpsAvailability(shpsOnly.finding), "shps-only");
  assert.deepEqual(
    filterShpsFindings([shpsOnly.finding], { filter: "only" }),
    [shpsOnly.finding],
  );

  const shpsWithHtb = findingFrom({
    id: "24002",
    schemeText: "This development is available under LAAPS. Help to Buy funding may also be available.",
  });
  assert.match(shpsWithHtb.finding.schemeText ?? "", /\bLAAPS\b/);
  assert.match(shpsWithHtb.finding.schemeText ?? "", /\bHelp to Buy\b/);
  assert.equal(classifyShpsAvailability(shpsWithHtb.finding), "shps-and-other");
  assert.deepEqual(
    filterShpsFindings([shpsWithHtb.finding], { filter: "only" }),
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

  const staleCardFacts: SourcedFinding = {
    source: "myhome",
    sourceId: "12345678",
    finding: {
      id: "old:12345678",
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
  assert.equal(enriched.finding.priceText, "Price unavailable");
  assert.equal(enriched.finding.bedrooms, undefined);
  assert.equal(enriched.finding.bathrooms, undefined);
  assert.equal(enriched.finding.propertyType, undefined);
  assert.equal(enriched.finding.floorSizeSqm, undefined);
});

test("keeps POA nonnumeric and marks malformed individual prices unverified", () => {
  const poa = findingFrom({ id: "10001", price: "POA" });
  assert.equal(poa.finding.priceText, "POA");
  assert.equal(poa.myhomeEvidence.priceState, "poa");
  assert.equal(poa.myhomeEvidence.priceEur, undefined);
  const priceFilteredPoa = apply([poa], { priceMinEur: 400_000 });
  assert.deepEqual(priceFilteredPoa.findings, []);
  assert.deepEqual(priceFilteredPoa.unsupportedFilters, []);

  for (const [index, price] of [
    "€2,500 per month",
    "€2,500 / month",
    "€2,500 monthly",
  ].entries()) {
    const rental = findingFrom({ id: String(10010 + index), price });
    assert.equal(rental.myhomeEvidence.priceState, "amount", price);
    assert.equal(rental.myhomeEvidence.priceEur, 2_500, price);
    assert.deepEqual(
      apply([rental], { priceMinEur: 2_500 }, "property-for-rent").findings,
      [rental],
    );
  }
  const monthlyRange = findingFrom({ id: "10020", price: "€2,500 - €3,000 per month" });
  assert.equal(monthlyRange.myhomeEvidence.priceState, "unknown");
  assert.equal(monthlyRange.myhomeEvidence.priceEur, undefined);

  const malformed = findingFrom({ id: "10002", price: "€450,000 - €475,000" });
  assert.equal(malformed.myhomeEvidence.priceState, "unknown");
  assert.equal(malformed.myhomeEvidence.priceEur, undefined);
  const malformedResult = apply([malformed], { priceMinEur: 400_000 });
  assert.deepEqual(malformedResult.findings, []);
  assert.deepEqual(malformedResult.unsupportedFilters, []);
  assert.deepEqual(malformedResult.unverifiedSourceIds, ["10002"]);
  assert.equal(malformedResult.filterSources.priceMinEur, "source-backed-local");
});

test("retains verified houses and excludes apartment, duplex, and unknown types in mixed developments", () => {
  const house = findingFrom({ id: "20001", propertyType: "Terraced House", price: "€520,000", bedrooms: "4" });
  const apartment = findingFrom({ id: "20002", propertyType: "Apartment", bedrooms: "3" });
  const duplex = findingFrom({ id: "20003", propertyType: "Duplex", bedrooms: "3" });
  const unverified = findingFrom({ id: "20004", propertyType: undefined, bedrooms: "4" });
  const result = apply(
    [apartment, house, duplex, unverified],
    { propertyTypes: ["houses"], bedsMin: 3, priceMinEur: 500_000 },
  );
  assert.deepEqual(result.findings.map((finding) => finding.sourceId), ["20001"]);
  assert.deepEqual(result.unverifiedSourceIds, ["20004"]);
  assert.deepEqual(result.unsupportedFilters, []);
  assert.equal(result.findings[0]?.myhomeEvidence.priceEur, 520_000);
});

test("maps each explicit MyHome property type and Daft facility locally", () => {
  const typeCases = [
    ["House", "houses"],
    ["Detached House", "detached-houses"],
    ["Semi-Detached House", "semi-detached-houses"],
    ["Terraced House", "terraced-houses"],
    ["End of Terrace House", "end-of-terrace-houses"],
    ["Townhouse", "townhouses"],
    ["Apartment", "apartments"],
    ["Studio Apartment", "studio-apartments"],
    ["Duplex", "duplexes"],
    ["Bungalow", "bungalows"],
    ["Site", "sites"],
  ] as const;
  for (const [index, [sourceType, daftType]] of typeCases.entries()) {
    const property = findingFrom({ id: String(21000 + index), propertyType: sourceType });
    assert.deepEqual(apply([property], { propertyTypes: [daftType] }).findings, [property]);
  }

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
  assert.deepEqual(
    apply([allFacilities], { facilities: ["alarm", "gas-fired-central-heating", "parking"] }, "property-for-sale").findings,
    [allFacilities],
  );
  const wiredCableOnly = findingFrom({ id: "21998", features: ["Wired for Cable Television"] });
  assert.deepEqual(wiredCableOnly.myhomeEvidence.facilities, ["wired-for-cable-television"]);
});

test("excludes records that lack evidence for an active supported filter", () => {
  const assertUnverified = (
    candidate: MyHomeFinding,
    filters: Partial<DaftFilters> = {},
    section: DaftSectionPath = "new-homes-for-sale",
  ): void => {
    const result = apply([candidate], filters, section);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.unsupportedFilters, []);
    assert.deepEqual(result.unverifiedSourceIds, [candidate.sourceId]);
  };
  assertUnverified(findingFrom({ id: "22001", availability: undefined }));
  assertUnverified(findingFrom({ id: "22002", publishedAt: undefined }), { addedInLastDays: 7 });
  assertUnverified(findingFrom({ id: "22020", publishedAt: undefined }), { sort: "publishDateDesc" });
  assertUnverified(findingFrom({ id: "22003", openViewing: undefined }), { openViewingsFrom: "2026-10-10" });
  assertUnverified(findingFrom({ id: "22004", floorArea: undefined }), { floorSizeMinSqm: 80 }, "property-for-sale");
  const missingSaleFacts = findingFrom({
    id: "22005",
    ber: undefined,
    saleType: undefined,
    onlineOffers: undefined,
    features: undefined,
  });
  assertUnverified(missingSaleFacts, { berMin: "C" }, "property-for-sale");
  assertUnverified(findingFrom({ id: "22007", saleType: "Unclear" }), { saleType: "auction" }, "property-for-sale");
  assertUnverified(missingSaleFacts, { saleType: "auction" }, "property-for-sale");
  assertUnverified(missingSaleFacts, { onlineOffers: true }, "property-for-sale");
  assertUnverified(missingSaleFacts, { facilities: ["alarm"] }, "property-for-sale");
  const missingRental = findingFrom({
    id: "22006",
    leaseLength: undefined,
    furnishing: undefined,
    features: undefined,
  });
  assertUnverified(missingRental, { leaseLengthMinMonths: 6 }, "property-for-rent");
  assertUnverified(missingRental, { furnishing: "furnished" }, "property-for-rent");
  assertUnverified(missingRental, { facilities: ["alarm"] }, "property-for-rent");

  const verified = findingFrom({ id: "22008", price: "€350,000" });
  const incomplete = findingFrom({ id: "22009", price: undefined });
  const partial = apply([verified, incomplete], { priceMinEur: 300_000 });
  assert.deepEqual(partial.findings.map((item) => item.sourceId), ["22008"]);
  assert.deepEqual(partial.unverifiedSourceIds, ["22009"]);
});

test("applies shared price, bed, bath, keyword, availability, date, and sort predicates locally", () => {
  const current = findingFrom({ id: "30001", title: "Harbour Home", price: "€520,000", bedrooms: "3", bathrooms: "2" });
  const cheaper = findingFrom({
    id: "30002",
    title: "Harbour Apartment House",
    price: "€480,000",
    bedrooms: "4",
    bathrooms: "3",
    publishedAt: "2026-09-28",
  });
  const saleAgreed = findingFrom({ id: "30003", availability: "Sale Agreed" });
  const noOffers = findingFrom({ id: "30004", onlineOffers: "No" });
  const notAuction = findingFrom({ id: "30005", saleType: "Private Treaty" });
  assert.deepEqual(apply([current], { priceMinEur: 520_000 }).findings, [current]);
  assert.deepEqual(apply([current], { priceMinEur: 520_001 }).findings, []);
  assert.deepEqual(apply([current], { priceMaxEur: 520_000 }).findings, [current]);
  assert.deepEqual(apply([current], { priceMaxEur: 519_999 }).findings, []);
  assert.deepEqual(apply([current], { bedsMin: 3, bedsMax: 3 }).findings, [current]);
  assert.deepEqual(apply([current], { bedsMin: 4 }).findings, []);
  assert.deepEqual(apply([current], { bedsMax: 2 }).findings, []);
  assert.deepEqual(apply([current], { bathsMin: 2, bathsMax: 2 }).findings, [current]);
  assert.deepEqual(apply([current], { bathsMin: 3 }).findings, []);
  assert.deepEqual(apply([current], { bathsMax: 1 }).findings, []);
  assert.deepEqual(apply([current], { keyword: "harbour" }).findings, [current]);
  assert.deepEqual(apply([current], { keyword: "garage" }).findings, []);
  assert.deepEqual(apply([current], { addedInLastDays: 7 }).findings, [current]);
  assert.deepEqual(apply([current], { addedInLastDays: 1 }).findings, [current]);
  assert.deepEqual(
    applyMyHomeFilters(
      [current],
      "new-homes-for-sale",
      { ...EMPTY_FILTERS, addedInLastDays: 7 },
      new Date("invalid"),
    ).findings,
    [],
  );
  assert.deepEqual(apply([current, cheaper], { sort: "priceAsc" }).findings, [cheaper, current]);
  assert.deepEqual(apply([current, cheaper], { sort: "priceDesc" }).findings, [current, cheaper]);
  assert.deepEqual(apply([current, cheaper], { sort: "publishDateDesc" }).findings, [current, cheaper]);
  assert.deepEqual(apply([current], { availability: "published" }).findings, [current]);
  assert.deepEqual(apply([saleAgreed], { availability: "sale-agreed" }).findings, [saleAgreed]);
  assert.deepEqual(apply([current], { availability: "sale-agreed" }).findings, []);
  assert.deepEqual(apply([noOffers], { onlineOffers: false }, "property-for-sale").findings, [noOffers]);
  assert.deepEqual(apply([notAuction], { saleType: "auction" }, "property-for-sale").findings, []);
});

test("includes every Added In Last period through its full-day cutoff", () => {
  const dayMs = 86_400_000;
  const today = Date.UTC(
    FIXED_NOW.getUTCFullYear(),
    FIXED_NOW.getUTCMonth(),
    FIXED_NOW.getUTCDate(),
  );
  for (const days of DAFT_ADDED_IN_LAST_DAYS) {
    if (days === 0) {
      const noCutoff = findingFrom({ id: "50000", publishedAt: "2020-01-01" });
      assert.deepEqual(
        apply([noCutoff], { addedInLastDays: days }).findings,
        [noCutoff],
        "zero days disables the publication-date cutoff",
      );
      continue;
    }
    const cutoff = new Date(today - days * dayMs).toISOString().slice(0, 10);
    const outside = new Date(today - (days + 1) * dayMs).toISOString().slice(0, 10);
    const inRange = findingFrom({
      id: String(50000 + days),
      publishedAt: cutoff,
    });
    const outOfRange = findingFrom({
      id: String(51000 + days),
      publishedAt: outside,
    });
    assert.deepEqual(
      apply([inRange], { addedInLastDays: days }).findings,
      [inRange],
      `${days} days includes its cutoff date`,
    );
    assert.deepEqual(
      apply([outOfRange], { addedInLastDays: days }).findings,
      [],
      `${days} days excludes the preceding date`,
    );
  }
});

test("applies new-home viewing and property-sale/rental detail predicates within Daft scopes", () => {
  const candidate = findingFrom({ id: "40001" });
  assert.deepEqual(
    apply([candidate], { openViewingsFrom: "2026-10-10" }, "new-homes-for-sale").findings,
    [candidate],
  );
  assert.deepEqual(
    apply([candidate], { openViewingsFrom: "2026-10-16" }, "new-homes-for-sale").findings,
    [],
  );
  const saleFilters: Partial<DaftFilters> = {
    floorSizeMinSqm: 100,
    floorSizeMaxSqm: 100,
    berMin: "C",
    berMax: "C",
    saleType: "auction",
    onlineOffers: true,
    facilities: ["alarm", "parking"],
  };
  assert.deepEqual(apply([candidate], saleFilters, "property-for-sale").findings, [candidate]);
  assert.deepEqual(apply([candidate], { floorSizeMinSqm: 101 }, "property-for-sale").findings, []);
  assert.deepEqual(apply([candidate], { berMin: "B" }, "property-for-sale").findings, []);
  assert.deepEqual(apply([candidate], { onlineOffers: false }, "property-for-sale").findings, []);
  assert.deepEqual(apply([candidate], { facilities: ["dishwasher"] }, "property-for-sale").findings, []);
  const rentFilters: Partial<DaftFilters> = {
    leaseLengthMinMonths: 12,
    leaseLengthMaxMonths: 12,
    furnishing: "furnished",
    facilities: ["alarm", "parking"],
  };
  assert.deepEqual(apply([candidate], rentFilters, "property-for-rent").findings, [candidate]);
  assert.deepEqual(apply([candidate], { leaseLengthMinMonths: 24 }, "property-for-rent").findings, []);
  assert.deepEqual(apply([candidate], { furnishing: "unfurnished" }, "property-for-rent").findings, []);
  assert.deepEqual(apply([candidate], { openViewingsFrom: "2026-10-16" }, "property-for-sale").findings, [candidate]);
  assert.deepEqual(apply([candidate], { leaseLengthMinMonths: 24 }, "property-for-sale").findings, [candidate]);
});

test("normalizes granular MyHome BER grades for broad-band filters", () => {
  for (const [id, grade, band] of [
    ["33001", "A2", "A"],
    ["33002", "B2", "B"],
    ["33003", "B3", "B"],
  ] as const) {
    const candidate = findingFrom({ id, ber: grade });
    assert.equal(candidate.finding.berRating, band);
    assert.deepEqual(
      apply([candidate], { berMin: band }, "property-for-sale").findings,
      [candidate],
    );
    assert.deepEqual(
      apply([candidate], { berMax: band }, "property-for-sale").findings,
      [candidate],
    );
  }

  const invalidGrade = findingFrom({ id: "33004", ber: "B4" });
  const result = apply([invalidGrade], { berMin: "C" }, "property-for-sale");
  assert.equal(invalidGrade.finding.berRating, undefined);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.unverifiedSourceIds, [invalidGrade.sourceId]);
});


test("maps filter support by section and fails closed for unsupported features or missing facts", () => {
  const common = validateMyHomeFilterSupport("new-homes-for-sale", {
    ...EMPTY_FILTERS,
    radiusKm: 20,
    mediaTypes: ["video"],
    openViewingsFrom: "2026-10-10",
    floorSizeMinSqm: 90,
    leaseLengthMinMonths: 12,
    availability: "published",
  });
  assert.deepEqual(common.unsupportedFilters, ["radiusKm", "mediaTypes"]);
  assert.deepEqual(common.supportedFilters, ["availability", "openViewingsFrom"]);
  assert.equal(common.filterSources.openViewingsFrom, "source-backed-local");

  const saleScope = validateMyHomeFilterSupport("property-for-sale", {
    ...EMPTY_FILTERS,
    floorSizeMinSqm: 90,
    berMin: "D",
    saleType: "auction",
    onlineOffers: false,
    facilities: ["gas-fired-central-heating"],
    openViewingsFrom: "2026-10-10",
    furnishing: "furnished",
    availability: "published",
  });
  assert.deepEqual(saleScope.unsupportedFilters, []);
  assert.deepEqual(saleScope.supportedFilters, [
    "availability",
    "floorSizeMinSqm",
    "berMin",
    "saleType",
    "onlineOffers",
    "facilities",
  ]);

  const rentScope = validateMyHomeFilterSupport("property-for-rent", {
    ...EMPTY_FILTERS,
    leaseLengthMaxMonths: 24,
    furnishing: "furnished",
    facilities: ["pets-allowed"],
    floorSizeMinSqm: 90,
    onlineOffers: false,
    availability: "published",
  });
  assert.deepEqual(rentScope.unsupportedFilters, []);
  assert.deepEqual(rentScope.supportedFilters, [
    "availability",
    "leaseLengthMaxMonths",
    "furnishing",
    "facilities",
  ]);

  assert.deepEqual(validateMyHomeFilterSupport("new-homes-for-sale", {
    ...EMPTY_FILTERS,
    facilities: ["alarm"],
  }).unsupportedFilters, ["facilities"]);
  assert.deepEqual(validateMyHomeFilterSupport("property-for-rent", {
    ...EMPTY_FILTERS,
    facilities: ["gas-fired-central-heating"],
  }).unsupportedFilters, ["facilities"]);
  assert.deepEqual(validateMyHomeFilterSupport("new-homes-for-sale", {
    ...EMPTY_FILTERS,
    sort: "bestMatch",
  }).unsupportedFilters, ["sort"]);
  const staticUnsupported = apply([findingFrom()], { radiusKm: 20 });
  assert.deepEqual(staticUnsupported.findings, []);
  assert.deepEqual(staticUnsupported.unsupportedFilters, ["radiusKm"]);

  const incomplete = findingFrom({ id: "40002", price: undefined });
  const failedClosed = apply([incomplete], { priceMinEur: 300_000 });
  assert.deepEqual(failedClosed.findings, []);
  assert.deepEqual(failedClosed.unsupportedFilters, []);
  assert.deepEqual(failedClosed.unverifiedSourceIds, ["40002"]);
  const notAType = findingFrom({ id: "40003", propertyType: undefined });
  const unverified = apply([notAType], { propertyTypes: ["houses"] });
  assert.deepEqual(unverified.findings, []);
  assert.deepEqual(unverified.unverifiedSourceIds, ["40003"]);
});
