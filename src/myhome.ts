import {
  DAFT_FACILITIES,
  type DaftBerRating,
  type DaftFacility,
  type DaftFilters,
  type DaftFurnishing,
  type DaftPropertyType,
} from "./daft/filters.js";
import type { DaftSectionPath } from "./daft/sections.js";
import type { ListingFacts, SourcedListing, SourcedListingFields } from "./listings.js";
import {
  attribute,
  descendants,
  elementText,
  firstElementText,
  normalize,
  parseHtml,
  type HtmlElement,
} from "./myhome/html.js";

type MyHomeSearchRoutes = {
  readonly nationalPath: string;
  readonly locationRoot: "residential" | "rentals";
  readonly genericSuffix: string;
  readonly houseSuffix: string;
};
type MyHomeSectionRoutes = {
  readonly published: MyHomeSearchRoutes;
  readonly saleAgreed?: MyHomeSearchRoutes;
};
const SECTION_SEARCH_ROUTES: Readonly<Record<
  DaftSectionPath,
  MyHomeSectionRoutes
>> = {
  "new-homes-for-sale": {
    published: {
      nationalPath: "/residential/ireland/new-homes/property-for-sale",
      locationRoot: "residential",
      genericSuffix: "/new-homes/property-for-sale",
      houseSuffix: "/new-homes/house-for-sale",
    },
  },
  "property-for-sale": {
    published: {
      nationalPath: "/residential/ireland/property-for-sale",
      locationRoot: "residential",
      genericSuffix: "/property-for-sale",
      houseSuffix: "/house-for-sale",
    },
    saleAgreed: {
      nationalPath: "/residential/ireland/sale-agreed-property",
      locationRoot: "residential",
      genericSuffix: "/sale-agreed-property",
      houseSuffix: "/sale-agreed-house",
    },
  },
  "property-for-rent": {
    published: {
      nationalPath: "/rentals/ireland/property-to-rent",
      locationRoot: "rentals",
      genericSuffix: "/property-to-rent",
      houseSuffix: "/house-to-rent",
    },
  },
};
const searchRoutesFor = (
  sectionPath: DaftSectionPath,
  availability: DaftFilters["availability"],
): MyHomeSearchRoutes => {
  const sectionRoutes = SECTION_SEARCH_ROUTES[sectionPath];
  return availability === "sale-agreed" && sectionRoutes.saleAgreed !== undefined
    ? sectionRoutes.saleAgreed
    : sectionRoutes.published;
};
export const getMyHomeNationalSearchPath = (
  sectionPath: DaftSectionPath,
  availability: DaftFilters["availability"] = "published",
): string => searchRoutesFor(sectionPath, availability).nationalPath;

const HOUSE_PROPERTY_TYPES: Readonly<Record<string, true>> = {
  houses: true,
  "detached-houses": true,
  "semi-detached-houses": true,
  "terraced-houses": true,
  "end-of-terrace-houses": true,
  townhouses: true,
  bungalows: true,
};
const BER_RATINGS: readonly DaftBerRating[] = [
  "exempt",
  "G",
  "F",
  "E",
  "D",
  "C",
  "B",
  "A",
  "A0",
];
const FACILITY_PHRASES: Readonly<Record<DaftFacility, readonly string[]>> = {
  alarm: ["alarm"],
  "cable-television": ["cable television", "cable tv"],
  "central-heating": ["central heating"],
  dishwasher: ["dishwasher"],
  dryer: ["tumble dryer", "dryer"],
  "garden-patio-balcony": ["garden", "patio", "balcony"],
  "gas-fired-central-heating": ["gas fired central heating", "gas central heating"],
  internet: ["internet", "broadband"],
  microwave: ["microwave"],
  "oil-fired-central-heating": ["oil fired central heating", "oil central heating"],
  parking: ["parking", "car space"],
  "pets-allowed": ["pets allowed", "pet friendly"],
  "serviced-property": ["serviced property", "serviced apartment"],
  smoking: ["smoking allowed"],
  "washing-machine": ["washing machine"],
  "wheelchair-access": ["wheelchair access", "wheelchair accessible"],
  "wired-for-cable-television": ["wired for cable", "cable tv connection"],
};

type PropertyTypeMapping = {
  readonly label: string;
  readonly daftTypes: readonly DaftPropertyType[];
};
const PROPERTY_TYPES: readonly PropertyTypeMapping[] = [
  { label: "End of terrace house", daftTypes: ["houses", "terraced-houses", "end-of-terrace-houses"] },
  { label: "Semi-detached house", daftTypes: ["houses", "semi-detached-houses"] },
  { label: "Detached house", daftTypes: ["houses", "detached-houses"] },
  { label: "Terraced house", daftTypes: ["houses", "terraced-houses"] },
  { label: "Townhouse", daftTypes: ["houses", "townhouses"] },
  { label: "Bungalow", daftTypes: ["houses", "bungalows"] },
  { label: "Studio apartment", daftTypes: ["apartments", "studio-apartments"] },
  { label: "Apartment", daftTypes: ["apartments"] },
  { label: "Duplex", daftTypes: ["duplexes"] },
  { label: "Site", daftTypes: ["sites"] },
  { label: "House", daftTypes: ["houses"] },
];
const SCHEME_EVIDENCE_MARKERS = [
  /\b(?:help to buy|htb|shps|laaps)\b/i,
  /\b(?:starter home purchase scheme|starter homes? programme)\b/i,
  /\b(?:local authority affordable purchase(?: scheme)?|affordable dwelling purchase arrangement|affordable purchase scheme|first home scheme|cost rental)\b/i,
] as const;


export type MyHomeFilterName = keyof DaftFilters;
export type MyHomeFilterSource = "native" | "unsupported";

export interface MyHomeFilterSupport {
  readonly supportedFilters: readonly MyHomeFilterName[];
  readonly unsupportedFilters: readonly MyHomeFilterName[];
  readonly filterSources: Readonly<Partial<Record<MyHomeFilterName, MyHomeFilterSource>>>;
}
export type MyHomeLocationFilter = "locations" | "radiusKm";

export interface MyHomeLocationSupport {
  readonly searchPath?: string;
  readonly unsupportedLocationFilters: readonly MyHomeLocationFilter[];
}

export interface MyHomeEvidence {
  readonly typeVerified: boolean;
  readonly daftPropertyTypes: readonly DaftPropertyType[];
  readonly priceState: "amount" | "poa" | "unknown";
  readonly priceEur?: number;
  readonly availability?: "published" | "sale-agreed";
  readonly publishedAt?: string;
  readonly openViewingDates: readonly string[];
  readonly openViewingsVerified: boolean;
  readonly facilities: readonly DaftFacility[];
  readonly facilitiesVerified: boolean;
  readonly leaseLengthMonths?: number;
  readonly furnishing?: DaftFurnishing;
  readonly saleType?: "auction";
  readonly saleTypeVerified: boolean;
  readonly onlineOffers?: boolean;
  readonly onlineOffersVerified: boolean;
  readonly searchableText: string;
}

export interface MyHomeFinding extends SourcedListingFields {
  readonly source: "myhome";
  readonly myhomeEvidence: MyHomeEvidence;
}

export interface MyHomeListPage {
  readonly findings: MyHomeFinding[];
  readonly currentPage: number;
  readonly totalPages: number;
}

export interface MyHomeDetail
  extends Partial<Omit<ListingFacts, "url" | "priceText">> {
  readonly sourceId: string;
  readonly url: string;
  readonly priceText?: string;
  readonly myhomeEvidence: MyHomeEvidence;
  readonly latitude?: number;
  readonly longitude?: number;
}



const canonicalMyHomePath = (path: string): string | undefined => {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("?") ||
    path.includes("#")
  ) {
    return undefined;
  }
  const canonical = path.replace(/\/+$/, "");
  if (
    !(canonical.startsWith("/residential/") || canonical.startsWith("/rentals/")) ||
    canonical.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return undefined;
  }
  return canonical;
};

interface MyHomePathParts {
  readonly basePath: string;
  readonly canonicalPath: string;
}

const myHomePathParts = (pathname: string): MyHomePathParts | undefined => {
  let parts: MyHomePathParts | undefined;
  for (const match of pathname.matchAll(/\/(?:residential|rentals)\//g)) {
    const canonicalPath = canonicalMyHomePath(pathname.slice(match.index));
    if (canonicalPath !== undefined) {
      parts = {
        basePath: pathname.slice(0, match.index).replace(/\/+$/, ""),
        canonicalPath,
      };
    }
  }
  return parts;
};

const sourceIdFromUrl = (url: URL): string => {
  const path = myHomePathParts(url.pathname)?.canonicalPath;
  const segments = path?.split("/").filter(Boolean);
  const sourceId = segments?.at(-1);
  const nonListingRoute = segments?.slice(1, -1).some((segment) =>
    /^(?:agent|agents|estate-agent|estate-agents)$/i.test(segment),
  ) === true;
  if (
    path === undefined ||
    segments === undefined ||
    segments.length < 3 ||
    sourceId === undefined ||
    !/^\d+$/.test(sourceId) ||
    nonListingRoute
  ) {
    throw new Error(`MyHome detail URL must identify a listing: ${url.pathname}`);
  }
  return sourceId;
};

/** Builds canonical residential or rental URLs with optional query parameters and pagination. */
export const buildMyHomeUrl = (
  baseUrl: string,
  canonicalPath: string,
  page = 1,
  searchParams?: URLSearchParams,
): string => {
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`MyHome page must be a positive integer: ${page}`);
  }
  const base = new URL(baseUrl);
  if (base.username !== "" || base.password !== "") {
    throw new Error("MyHome base URL must not contain credentials");
  }
  const url = new URL(canonicalPath, base.origin);
  if (url.origin !== base.origin) {
    throw new Error("MyHome URLs must remain on the configured origin");
  }
  const normalizedPath = canonicalMyHomePath(url.pathname);
  if (normalizedPath === undefined || url.search !== "" || url.hash !== "") {
    throw new Error("MyHome URLs must be canonical /residential or /rentals paths without a query or fragment");
  }
  url.pathname = `${base.pathname.replace(/\/+$/, "")}${normalizedPath}`;
  const query = new URLSearchParams(searchParams);
  if (page > 1) {
    query.set("page", String(page));
  } else {
    query.delete("page");
  }
  url.search = query.toString();
  return url.toString();
};

const collectRegionRoutes = (value: unknown, routes: Record<string, true>): void => {
  if (Array.isArray(value)) {
    for (const child of value) { collectRegionRoutes(child, routes); }
    return;
  }
  if (typeof value !== "object" || value === null) { return; }
  for (const key of Object.getOwnPropertyNames(value)) {
    const child: unknown = Reflect.get(value, key) as unknown;
    if (
      key === "RegionUrls" &&
      typeof child === "object" &&
      child !== null &&
      !Array.isArray(child)
    ) {
      for (const name of Object.getOwnPropertyNames(child)) {
        const route: unknown = Reflect.get(child, name) as unknown;
        if (typeof route !== "string") { continue; }
        const canonical = canonicalMyHomePath(route);
        if (canonical !== undefined) { routes[canonical] = true; }
      }
    } else {
      collectRegionRoutes(child, routes);
    }
  }
};

/** Extracts only canonical route paths exposed by MyHome's server-rendered RegionUrls state. */
export const parseMyHomeRegionRoutes = (html: string): readonly string[] => {
  const stateScript = /<script\b(?=[^>]*\bid\s*=\s*["']ng-state["'])[^>]*>([\s\S]*?)<\/script\s*>/i.exec(html);
  const stateJson = stateScript?.[1];
  if (stateJson === undefined) { return []; }
  let state: unknown;
  try {
    state = JSON.parse(stateJson);
  } catch {
    return [];
  }
  const routes: Record<string, true> = {};
  collectRegionRoutes(state, routes);
  return Object.keys(routes);
};

/** Resolves only routes confirmed by the page's RegionUrls state; unsupported scope has no path. */
export const resolveMyHomeSearchPath = (
  sectionPath: DaftSectionPath,
  locations: readonly string[],
  filters: DaftFilters,
  confirmedRegionRoutes: readonly string[],
): MyHomeLocationSupport => {
  const unsupportedLocationFilters: MyHomeLocationFilter[] = [];
  if (filters.radiusKm !== undefined && filters.radiusKm > 0) {
    unsupportedLocationFilters.push("radiusKm");
  }
  if (locations.length > 1) {
    return {
      unsupportedLocationFilters: [...unsupportedLocationFilters, "locations"],
    };
  }
  if (locations.length === 0) {
    return {
      searchPath: searchRoutesFor(sectionPath, filters.availability).nationalPath,
      unsupportedLocationFilters,
    };
  }
  const location = locations[0];
  if (location === undefined || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(location)) {
    return { unsupportedLocationFilters: ["locations"] };
  }
  const routes = searchRoutesFor(sectionPath, filters.availability);
  const locationPrefix = `/${routes.locationRoot}/${location}`;
  const genericPath = `${locationPrefix}${routes.genericSuffix}`;
  const housePath = `${locationPrefix}${routes.houseSuffix}`;
  const evidencedRoutes: Record<string, true> = {};
  for (const route of confirmedRegionRoutes) {
    const canonical = canonicalMyHomePath(route);
    if (canonical !== undefined) { evidencedRoutes[canonical] = true; }
  }
  const houseOnly = filters.propertyTypes.length > 0 &&
    filters.propertyTypes.every((type) => HOUSE_PROPERTY_TYPES[type] === true);
  if (houseOnly && evidencedRoutes[housePath] === true) {
    return { searchPath: housePath, unsupportedLocationFilters };
  }
  if (evidencedRoutes[genericPath] === true) {
    return { searchPath: genericPath, unsupportedLocationFilters };
  }
  return { unsupportedLocationFilters: ["locations"] };
};

const pageNumberFromUrl = (url: URL): number => {
  if (url.hash !== "") { throw new Error("MyHome page URLs must not contain fragments"); }
  const pageValues = url.searchParams.getAll("page");
  if (pageValues.length === 0) { return 1; }
  const pageValue = pageValues.length === 1 ? pageValues[0] : undefined;
  if (pageValue === undefined || !/^[1-9][0-9]*$/.test(pageValue)) {
    throw new Error("MyHome pages may use only one positive decimal page query parameter");
  }
  const page = Number(pageValue);
  if (!Number.isSafeInteger(page)) {
    throw new Error("MyHome pages may use only one positive decimal page query parameter");
  }
  return page;
};

const detailUrlFromHref = (href: string, pageUrl: URL): string | undefined => {
  try {
    const candidate = new URL(href, pageUrl);
    if (candidate.origin !== pageUrl.origin || candidate.hash !== "" || candidate.search !== "") {
      return undefined;
    }
    const pagePath = myHomePathParts(pageUrl.pathname);
    const candidatePath = myHomePathParts(candidate.pathname);
    if (
      pagePath === undefined ||
      candidatePath === undefined ||
      (candidatePath.basePath !== "" && candidatePath.basePath !== pagePath.basePath)
    ) {
      return undefined;
    }
    const base = new URL(pageUrl.origin);
    base.pathname = pagePath.basePath || "/";
    const canonical = buildMyHomeUrl(base.toString(), candidatePath.canonicalPath);
    sourceIdFromUrl(new URL(canonical));
    return canonical;
  } catch {
    return undefined;
  }
};

const cardTitle = (anchor: HtmlElement, sourceId: string): string =>
  attribute(anchor, "aria-label") ??
  attribute(anchor, "title") ??
  (elementText(anchor) || `MyHome listing ${sourceId}`);

const hasListingCardContext = (anchor: HtmlElement): boolean => {
  for (let context: HtmlElement | undefined = anchor; context !== undefined; context = context.parent) {
    if (context.tag === "article") { return true; }
    const marker = ["class", "data-testid", "data-type", "itemtype"]
      .map((name) => attribute(context, name) ?? "")
      .join(" ")
      .replace(/([a-z])([A-Z])/g, "$1 $2");
    if (
      /\bcard\b|\b(?:listing|property).*\b(?:card|item|result)\b|\b(?:card|item|result).*\b(?:listing|property)\b/i
        .test(marker)
    ) {
      return true;
    }
  }
  return false;
};

const unverifiedEvidence = (searchableText = ""): MyHomeEvidence => ({
  typeVerified: false,
  daftPropertyTypes: [],
  priceState: "unknown",
  openViewingDates: [],
  openViewingsVerified: false,
  facilities: [],
  facilitiesVerified: false,
  saleTypeVerified: false,
  onlineOffersVerified: false,
  searchableText,
});

const totalPagesFromDescription = (
  root: HtmlElement,
  currentPage: number,
): number | undefined => {
  const description = [...descendants(root)].find((element) =>
    element.tag === "meta" && attribute(element, "name")?.toLowerCase() === "description",
  );
  const content = description === undefined ? undefined : attribute(description, "content");
  const match = content === undefined
    ? undefined
    : /\blistings\s+([\d,]+)\s*-\s*([\d,]+)\s*\(out of\s+([\d,]+)\)/i.exec(content);
  const start = match?.[1] === undefined ? Number.NaN : Number(match[1].replaceAll(",", ""));
  const end = match?.[2] === undefined ? Number.NaN : Number(match[2].replaceAll(",", ""));
  const total = match?.[3] === undefined ? Number.NaN : Number(match[3].replaceAll(",", ""));
  const resultCount = end - start + 1;
  const inferredPageSize = currentPage > 1 ? (start - 1) / (currentPage - 1) : resultCount;
  const pageSize = Number.isSafeInteger(inferredPageSize) && inferredPageSize >= resultCount
    ? inferredPageSize
    : resultCount;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 1 ||
    resultCount < 1 ||
    total < 0
  ) {
    return undefined;
  }
  return Math.max(1, Math.ceil(total / pageSize));
};

/** Parses canonical residential cards and pagination links; duplicate responsive cards collapse by URL. */
export const parseMyHomeListPage = (
  html: string,
  pageUrl: string,
): MyHomeListPage => {
  const parsedUrl = new URL(pageUrl);
  const currentPage = pageNumberFromUrl(parsedUrl);
  const pagePath = myHomePathParts(parsedUrl.pathname);
  if (pagePath === undefined) {
    throw new Error("MyHome page URLs must use canonical /residential or /rentals paths");
  }
  const base = new URL(parsedUrl.origin);
  base.pathname = pagePath.basePath || "/";
  const canonicalPageUrl = new URL(
    buildMyHomeUrl(base.toString(), pagePath.canonicalPath, currentPage, parsedUrl.searchParams),
  );
  const root = parseHtml(html);
  const byUrl = new Map<string, MyHomeFinding>();
  let totalPages = Math.max(currentPage, totalPagesFromDescription(root, currentPage) ?? currentPage);
  for (const element of descendants(root)) {
    if (element.tag === "link") {
      if (attribute(element, "rel")?.toLowerCase().split(/\s+/).includes("next") === true) {
        const href = attribute(element, "href");
        if (href !== undefined) {
          try {
            const target = new URL(href, canonicalPageUrl);
            if (target.origin === canonicalPageUrl.origin && target.pathname === canonicalPageUrl.pathname) {
              totalPages = Math.max(totalPages, pageNumberFromUrl(target));
            }
          } catch {
            // Invalid or non-canonical pagination links never broaden the requested route.
          }
        }
      }
      continue;
    }
    if (element.tag !== "a") { continue; }
    const href = attribute(element, "href");
    if (href === undefined) { continue; }
    try {
      const target = new URL(href, canonicalPageUrl);
      if (target.origin === canonicalPageUrl.origin && target.pathname === canonicalPageUrl.pathname) {
        const linkedPage = pageNumberFromUrl(target);
        totalPages = Math.max(totalPages, linkedPage);
        continue;
      }
    } catch {
      // Invalid or non-canonical pagination links are ignored; they never broaden the requested route.
    }
    if (!hasListingCardContext(element)) { continue; }
    const url = detailUrlFromHref(href, canonicalPageUrl);
    if (url === undefined || byUrl.has(url)) { continue; }
    const sourceId = sourceIdFromUrl(new URL(url));
    const title = cardTitle(element, sourceId);
    byUrl.set(url, {
      source: "myhome",
      sourceId,
      myhomeEvidence: unverifiedEvidence(title),
      facts: {
        title,
        developmentTitle: title,
        priceText: "Price unavailable",
        url,
      },
    });
  }
  return { findings: [...byUrl.values()], currentPage, totalPages };
};

const FIELD_ALIASES: Readonly<Record<string, readonly string[]>> = {
  address: ["address", "propertyaddress", "streetaddress"],
  availability: ["availability", "status", "listingstatus"],
  bathrooms: ["bath", "baths", "bathroom", "bathrooms", "numbaths"],
  bedrooms: ["bed", "beds", "bedroom", "bedrooms", "numbeds"],
  ber: ["ber", "berrating", "energyrating"],
  development: ["development", "developmentname", "developmenttitle"],
  eircode: ["eircode", "postalcode"],
  furnishing: ["furnishing", "furnishingstatus"],
  floorArea: ["floorarea", "floorsize", "floorareasqm", "size"],
  latitude: ["latitude"],
  leaseLength: ["leaselength", "leaseterm", "leaselengthmonths"],
  longitude: ["longitude"],
  onlineOffers: ["onlineoffers", "onlineoffersenabled"],
  price: ["askingprice", "price", "propertyprice"],
  publishedAt: ["datepublished", "publishedat", "publishdate"],
  propertyType: ["propertytype", "typeofproperty", "type"],
  saleType: ["saletype", "saleformat"],
  viewing: ["openviewing", "viewingdate", "viewingtime"],
};

const fieldForLabel = (label: string): string | undefined => {
  const normalized = normalize(label).replace(/\s/g, "");
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((alias) => normalized === alias || normalized.startsWith(`${alias} `))) {
      return field;
    }
  }
  const words = normalize(label);
  if (/^(?:number of )?(?:beds?|bedrooms?)$/.test(words)) { return "bedrooms"; }
  if (/^(?:number of )?(?:baths?|bathrooms?)$/.test(words)) { return "bathrooms"; }
  if (/^(?:floor )?(?:area|size)$/.test(words)) { return "floorArea"; }
  if (/^(?:asking )?price$/.test(words)) { return "price"; }
  if (/^property type$/.test(words)) { return "propertyType"; }
  if (/^(?:development|development name)$/.test(words)) { return "development"; }
  if (/^(?:date )?published$/.test(words)) { return "publishedAt"; }
  if (/^open viewing(?: date| time)?$/.test(words)) { return "viewing"; }
  return undefined;
};

const elementField = (element: HtmlElement): string | undefined => {
  for (const key of ["itemprop", "data-testid", "data-label", "data-field", "id", "class"]) {
    const value = attribute(element, key);
    if (value === undefined) { continue; }
    const field = fieldForLabel(value);
    if (field !== undefined) { return field; }
    const compact = normalize(value).replace(/\s/g, "");
    for (const [name, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some((alias) => compact.includes(alias))) { return name; }
    }
  }
  return undefined;
};

const elementValue = (element: HtmlElement): string =>
  attribute(element, "content") ??
  attribute(element, "datetime") ??
  attribute(element, "data-value") ??
  elementText(element);

const siblingFieldValue = (element: HtmlElement): { field: string; value: string } | undefined => {
  if (element.tag !== "dt" && element.tag !== "th") { return undefined; }
  const label = elementField(element) ?? fieldForLabel(elementText(element));
  const siblings = element.parent?.children;
  if (label === undefined || siblings === undefined) { return undefined; }
  const index = siblings.indexOf(element);
  const value = siblings.slice(index + 1).find(
    (child): child is HtmlElement => typeof child !== "string" && (child.tag === "dd" || child.tag === "td"),
  );
  const text = value === undefined ? "" : elementValue(value);
  return text === "" ? undefined : { field: label, value: text };
};

const fieldValues = (root: HtmlElement, field: string): string[] => {
  const values: string[] = [];
  const seen = new Set<string>();
  const add = (value: string): void => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized !== "" && !seen.has(normalized)) {
      seen.add(normalized);
      values.push(normalized);
    }
  };
  for (const element of descendants(root)) {
    if (elementField(element) === field) { add(elementValue(element)); }
    const paired = siblingFieldValue(element);
    if (paired?.field === field) { add(paired.value); }
  }
  return values;
};

const oneValue = (values: readonly string[]): string | undefined =>
  values.length === 1 ? values[0] : undefined;

const parseCount = (value: string | undefined): number | undefined => {
  if (value === undefined) { return undefined; }
  const match = /^\s*(\d{1,2})(?:\s*(?:bed(?:room)?s?|bath(?:room)?s?))?\s*$/i.exec(value);
  if (match?.[1] === undefined) { return undefined; }
  const count = Number(match[1]);
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
};

const parsePropertyType = (value: string | undefined): PropertyTypeMapping | undefined => {
  if (value === undefined) { return undefined; }
  const normalized = normalize(value);
  return PROPERTY_TYPES.find((mapping) => {
    const label = normalize(mapping.label);
    return normalized === label || normalized === label.replace(/ house$/, "");
  });
};

interface ParsedMyHomePrice {
  readonly state: MyHomeEvidence["priceState"];
  readonly priceEur?: number;
}
const parsePrice = (value: string | undefined): ParsedMyHomePrice => {
  if (value === undefined || value === "") { return { state: "unknown" }; }
  if (/^(?:poa|price on application)$/i.test(value.trim())) { return { state: "poa" }; }
  const match = /^€?\s*([\d,]+)(?:\.00)?(?:\s*(?:\/\s*month|per\s+(?:calendar\s+)?month|monthly|pcm|p\.?m\.?))?$/i
    .exec(value.trim());
  if (match?.[1] === undefined) { return { state: "unknown" }; }
  const amount = Number(match[1].replaceAll(",", ""));
  return Number.isSafeInteger(amount) && amount >= 0
    ? { state: "amount", priceEur: amount }
    : { state: "unknown" };
};

const parseFloorArea = (value: string | undefined): number | undefined => {
  if (value === undefined) { return undefined; }
  const match = /^\s*([\d,.]+)\s*(m²|sqm|sq\.?\s*m|square metres?|meters?\s*2|metres?\s*2|sq\.?\s*ft|square feet)\s*$/i
    .exec(value);
  if (match?.[1] === undefined || match[2] === undefined) { return undefined; }
  const size = Number(match[1].replaceAll(",", ""));
  if (!Number.isFinite(size) || size <= 0) { return undefined; }
  return /(?:sq\.?\s*ft|square feet)/i.test(match[2])
    ? Math.round(size * 0.092903 * 100) / 100
    : size;
};

const parseBer = (value: string | undefined): DaftBerRating | undefined => {
  if (value === undefined) { return undefined; }
  const normalized = value.trim().replace(/^ber\s*:?\s*/i, "").toUpperCase();
  const rating =
    /^(?:A[1-3]|B[1-3]|C[1-3]|D[1-2]|E[1-2])$/.test(normalized)
      ? normalized.slice(0, 1)
      : normalized;
  return BER_RATINGS.find((candidate) => candidate.toUpperCase() === rating);
};

const parseAvailability = (value: string | undefined): MyHomeEvidence["availability"] => {
  if (value === undefined) { return undefined; }
  const normalized = normalize(value);
  if (/sale agreed|let agreed|sold subject to contract/.test(normalized)) { return "sale-agreed"; }
  if (/^(?:for sale|available(?: to view)?|on market|published|to let|to rent)$/.test(normalized)) {
    return "published";
  }
  return undefined;
};

const parsePublishedDate = (value: string | undefined): string | undefined => {
  if (value === undefined) { return undefined; }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
};

const parseLeaseLength = (value: string | undefined): number | undefined => {
  if (value === undefined) { return undefined; }
  const normalized = value.trim().toLowerCase();
  const amount = /^(\d+)\s*(months?|years?)$/.exec(normalized);
  if (amount?.[1] === undefined || amount[2] === undefined) { return undefined; }
  const count = Number(amount[1]);
  return count * (amount[2].startsWith("year") ? 12 : 1);
};

const parseFurnishing = (value: string | undefined): DaftFurnishing | undefined => {
  if (value === undefined) { return undefined; }
  const normalized = normalize(value);
  if (normalized === "furnished") { return "furnished"; }
  if (normalized === "unfurnished") { return "unfurnished"; }
  return undefined;
};

const parseAuction = (value: string | undefined): "auction" | undefined =>
  value !== undefined && /\bauction\b/i.test(value) ? "auction" : undefined;

const parseBoolean = (value: string | undefined): boolean | undefined => {
  if (value === undefined) { return undefined; }
  const normalized = normalize(value);
  if (["yes", "true", "enabled", "available"].includes(normalized)) { return true; }
  if (["no", "false", "disabled", "not available"].includes(normalized)) { return false; }
  return undefined;
};

const coordinatesFromMapHref = (
  href: string,
): { readonly latitude: number; readonly longitude: number } | undefined => {
  try {
    const url = new URL(href);
    if (
      !(url.hostname === "google.com" || url.hostname.endsWith(".google.com")) ||
      !url.pathname.startsWith("/maps/")
    ) {
      return undefined;
    }
    const value = url.searchParams.get("destination") ??
      url.searchParams.get("viewpoint") ??
      url.searchParams.get("query");
    const match = value === null
      ? undefined
      : /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(value);
    if (match?.[1] === undefined || match[2] === undefined) { return undefined; }
    return { latitude: Number(match[1]), longitude: Number(match[2]) };
  } catch {
    return undefined;
  }
};

const parseCoordinates = (
  root: HtmlElement,
): { readonly latitude?: number; readonly longitude?: number } => {
  let latitude: number | undefined;
  let longitude: number | undefined;
  for (const element of descendants(root)) {
    const field = elementField(element);
    const dataLatitude = attribute(element, "data-latitude");
    const dataLongitude = attribute(element, "data-longitude");
    const value = elementValue(element);
    if (dataLatitude !== undefined) { latitude = Number(dataLatitude); }
    if (dataLongitude !== undefined) { longitude = Number(dataLongitude); }
    if (field === "latitude") { latitude = Number(value); }
    if (field === "longitude") { longitude = Number(value); }
    if (element.tag === "a") {
      const href = attribute(element, "href");
      const mapped = href === undefined ? undefined : coordinatesFromMapHref(href);
      if (mapped !== undefined) {
        latitude = mapped.latitude;
        longitude = mapped.longitude;
      }
    }
  }
  return {
    ...(latitude !== undefined && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? { latitude } : {}),
    ...(longitude !== undefined && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? { longitude } : {}),
  };
};

const featureSection = (root: HtmlElement): HtmlElement | undefined => {
  for (const element of descendants(root)) {
    const hook = ["class", "id", "data-testid", "aria-label"]
      .map((name) => attribute(element, name) ?? "")
      .join(" ");
    if (/features|amenities|facilities/i.test(hook)) { return element; }
    if (
      (element.tag === "h2" || element.tag === "h3") &&
      /^(?:features|facilities|amenities)$/i.test(elementText(element))
    ) {
      return element.parent ?? element;
    }
  }
  return undefined;
};

const facilityMatches = (
  featureText: string,
): DaftFacility[] => {
  const normalizedText = normalize(featureText);
  const cableFeatures = normalizedText.replaceAll("wired for cable television", "");
  return DAFT_FACILITIES.filter((facility) =>
    FACILITY_PHRASES[facility].some((phrase) =>
      (facility === "cable-television" ? cableFeatures : normalizedText)
        .includes(normalize(phrase)),
    ),
  );
};

const textForTitle = (root: HtmlElement): string | undefined => {
  const heading = firstElementText(root, (element) => element.tag === "h1");
  if (heading !== undefined) { return heading; }
  const meta = firstElementText(root, (element) =>
    element.tag === "meta" && ["og:title", "twitter:title"].includes(attribute(element, "property") ?? attribute(element, "name") ?? ""),
  );
  return meta;
};

const mainContent = (root: HtmlElement): HtmlElement =>
  [...descendants(root)].find((element) => element.tag === "main") ?? root;

const makeEvidence = (
  root: HtmlElement,
  propertyType: PropertyTypeMapping | undefined,
  price: ParsedMyHomePrice,
  openViewingDates: readonly string[],
  openViewingsVerified: boolean,
  facilities: readonly DaftFacility[],
  facilitiesVerified: boolean,
): MyHomeEvidence => {
  const explicitAvailability = oneValue(fieldValues(root, "availability"));
  const availability = parseAvailability(explicitAvailability) ??
    (
      explicitAvailability === undefined &&
      /\bavailable to view\b/i.test(elementText(root))
        ? "published"
        : undefined
    );
  const publishedAt = parsePublishedDate(oneValue(fieldValues(root, "publishedAt")));
  const leaseLengthMonths = parseLeaseLength(oneValue(fieldValues(root, "leaseLength")));
  const furnishing = parseFurnishing(oneValue(fieldValues(root, "furnishing")));
  const saleTypeValues = fieldValues(root, "saleType");
  const saleTypeValue = oneValue(saleTypeValues);
  const saleType = parseAuction(saleTypeValue);
  const saleTypeVerified =
    saleType !== undefined ||
    ["private treaty", "fixed price", "normal sale"].includes(normalize(saleTypeValue ?? ""));
  const onlineOfferValues = fieldValues(root, "onlineOffers");
  const onlineOffersVerified = onlineOfferValues.length === 1 && parseBoolean(onlineOfferValues[0]) !== undefined;
  const onlineOffers = onlineOffersVerified ? parseBoolean(onlineOfferValues[0]) : undefined;
  const searchableText = elementText(root);
  return {
    typeVerified: propertyType !== undefined,
    daftPropertyTypes: propertyType?.daftTypes ?? [],
    priceState: price.state,
    ...(price.priceEur === undefined ? {} : { priceEur: price.priceEur }),
    ...(availability === undefined ? {} : { availability }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    openViewingDates,
    openViewingsVerified,
    facilities,
    facilitiesVerified,
    ...(leaseLengthMonths === undefined ? {} : { leaseLengthMonths }),
    ...(furnishing === undefined ? {} : { furnishing }),
    ...(saleType === undefined ? {} : { saleType }),
    saleTypeVerified,
    ...(onlineOffers === undefined ? {} : { onlineOffers }),
    onlineOffersVerified,
    searchableText,
  };
};

const parseViewingData = (root: HtmlElement): { dates: string[]; verified: boolean } => {
  const dates: string[] = [];
  let verified = false;
  const addDate = (value: string): void => {
    const dateMatch = /\b\d{4}-\d{2}-\d{2}\b/.exec(value);
    if (dateMatch?.[0] !== undefined && parsePublishedDate(dateMatch[0]) !== undefined) {
      dates.push(dateMatch[0]);
    }
  };
  for (const value of fieldValues(root, "viewing")) {
    verified = true;
    addDate(value);
  }
  for (const element of descendants(root)) {
    let viewingContext = false;
    for (let context: HtmlElement | undefined = element; context !== undefined; context = context.parent) {
      const hook = ["class", "id", "data-testid", "aria-label"]
        .map((name) => attribute(context, name) ?? "")
        .join(" ");
      if (elementField(context) === "viewing" || /open.?viewing|viewing.?time/i.test(hook)) {
        viewingContext = true;
        verified = true;
        break;
      }
    }
    if (!viewingContext) { continue; }
    addDate(attribute(element, "datetime") ?? elementText(element));
  }
  return { dates: [...new Set(dates)], verified };
};

const parseAddress = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : value.trim() || undefined;

/** Parses one listing detail page without treating development aggregates as unit facts. */
export const parseMyHomeDetailPage = (
  html: string,
  detailUrl: string,
): MyHomeDetail => {
  const parsedUrl = new URL(detailUrl);
  const pagePath = myHomePathParts(parsedUrl.pathname);
  if (
    pageNumberFromUrl(parsedUrl) !== 1 ||
    parsedUrl.search !== "" ||
    pagePath === undefined
  ) {
    throw new Error("MyHome detail pages must use canonical no-query URLs");
  }
  const base = new URL(parsedUrl.origin);
  base.pathname = pagePath.basePath || "/";
  const url = buildMyHomeUrl(base.toString(), pagePath.canonicalPath);
  const sourceId = sourceIdFromUrl(new URL(url));
  const root = mainContent(parseHtml(html));
  const title = textForTitle(root);
  const rawType = oneValue(fieldValues(root, "propertyType"));
  const propertyType = parsePropertyType(rawType);
  const verified = propertyType !== undefined;
  const rawPrice = verified ? oneValue(fieldValues(root, "price")) : undefined;
  const parsedPrice = parsePrice(rawPrice);
  const rawBedrooms = parseCount(oneValue(fieldValues(root, "bedrooms")));
  const rawBathrooms = parseCount(oneValue(fieldValues(root, "bathrooms")));
  const rawFloorArea = parseFloorArea(oneValue(fieldValues(root, "floorArea")));
  const rawBer = parseBer(oneValue(fieldValues(root, "ber")));
  const address = parseAddress(oneValue(fieldValues(root, "address")));
  const eircode = parseAddress(oneValue(fieldValues(root, "eircode")));
  const detailText = elementText(root);
  const schemeText = verified && SCHEME_EVIDENCE_MARKERS.some((marker) => marker.test(detailText))
    ? detailText
    : undefined;
  const viewing = parseViewingData(root);
  const features = featureSection(root);
  const facilitiesVerified = features !== undefined;
  const facilities = features === undefined ? [] : facilityMatches(elementText(features));
  const evidence = makeEvidence(
    root,
    propertyType,
    parsedPrice,
    viewing.dates,
    viewing.verified,
    facilities,
    facilitiesVerified,
  );
  const coordinates = parseCoordinates(root);
  const data: MyHomeDetail = {
    sourceId,
    url,
    ...(title === undefined ? {} : { title }),
    ...(title === undefined ? {} : { developmentTitle: oneValue(fieldValues(root, "development")) ?? title }),
    priceText: verified ? rawPrice ?? "Price unavailable" : "Price unavailable",
    ...(verified && rawBedrooms !== undefined ? { bedrooms: rawBedrooms } : {}),
    ...(verified && rawBathrooms !== undefined ? { bathrooms: rawBathrooms } : {}),
    ...(propertyType === undefined ? {} : { propertyType: propertyType.label }),
    ...(verified && rawFloorArea !== undefined ? { floorSizeSqm: rawFloorArea } : {}),
    ...(verified && rawBer !== undefined ? { berRating: rawBer } : {}),
    ...(verified && address !== undefined ? { address } : {}),
    ...(verified && eircode !== undefined ? { eircode } : {}),
    ...(schemeText === undefined ? {} : { schemeText }),
    myhomeEvidence: evidence,
    ...coordinates,
  };
  return data;
};

/** Replaces aggregate card data with only facts explicitly parsed from that listing's detail page. */
export const enrichMyHomeFinding = (
  finding: SourcedListing,
  detail: MyHomeDetail,
): MyHomeFinding => {
  if (finding.source !== "myhome") { throw new Error("Only MyHome findings can be enriched with MyHome details"); }
  if (finding.sourceId !== detail.sourceId) {
    throw new Error(`MyHome detail ID ${detail.sourceId} does not match source ID ${finding.sourceId}`);
  }
  const title = detail.title ?? finding.facts.title;
  const facts: ListingFacts = {
    title,
    developmentTitle: detail.developmentTitle ?? title,
    priceText: detail.priceText ?? "Price unavailable",
    ...(detail.bedrooms === undefined ? {} : { bedrooms: detail.bedrooms }),
    ...(detail.bathrooms === undefined ? {} : { bathrooms: detail.bathrooms }),
    ...(detail.propertyType === undefined ? {} : { propertyType: detail.propertyType }),
    ...(detail.floorSizeSqm === undefined ? {} : { floorSizeSqm: detail.floorSizeSqm }),
    ...(detail.berRating === undefined ? {} : { berRating: detail.berRating }),
    ...(detail.address === undefined ? {} : { address: detail.address }),
    ...(detail.eircode === undefined ? {} : { eircode: detail.eircode }),
    ...(detail.schemeText === undefined ? {} : { schemeText: detail.schemeText }),
    url: detail.url,
  };
  return {
    source: "myhome",
    sourceId: finding.sourceId,
    facts,
    myhomeEvidence: detail.myhomeEvidence,
    ...(detail.latitude === undefined ? {} : { latitude: detail.latitude }),
    ...(detail.longitude === undefined ? {} : { longitude: detail.longitude }),
  };
};

const MYHOME_PROPERTY_TYPE_IDS: Readonly<Record<
  DaftSectionPath,
  Readonly<Partial<Record<DaftPropertyType, number>>>
>> = {
  "new-homes-for-sale": {
    apartments: 1,
    houses: 2,
    sites: 3,
  },
  "property-for-sale": {
    apartments: 36,
    houses: 97,
    "terraced-houses": 37,
    "semi-detached-houses": 38,
    "detached-houses": 39,
    bungalows: 40,
    "end-of-terrace-houses": 45,
    duplexes: 47,
    townhouses: 48,
    "studio-apartments": 50,
    sites: 44,
  },
  "property-for-rent": {
    apartments: 55,
    houses: 98,
    "terraced-houses": 56,
    "semi-detached-houses": 57,
    "detached-houses": 58,
    bungalows: 59,
    "end-of-terrace-houses": 64,
    duplexes: 66,
    townhouses: 67,
    "studio-apartments": 69,
    sites: 63,
  },
};

const activeFilterNames = (
  sectionPath: DaftSectionPath,
  filters: DaftFilters,
): MyHomeFilterName[] => {
  const facilities = filters.facilities ?? [];
  const active: MyHomeFilterName[] = [];
  if (filters.radiusKm !== undefined && filters.radiusKm > 0) { active.push("radiusKm"); }
  if (filters.priceMinEur !== undefined) { active.push("priceMinEur"); }
  if (filters.priceMaxEur !== undefined) { active.push("priceMaxEur"); }
  if (filters.bedsMin !== undefined) { active.push("bedsMin"); }
  if (filters.bedsMax !== undefined) { active.push("bedsMax"); }
  if (filters.propertyTypes.length > 0) { active.push("propertyTypes"); }
  if (filters.bathsMin !== undefined) { active.push("bathsMin"); }
  if (filters.bathsMax !== undefined) { active.push("bathsMax"); }
  if (filters.mediaTypes.length > 0) { active.push("mediaTypes"); }
  if (filters.keyword !== undefined && filters.keyword.trim() !== "") { active.push("keyword"); }
  active.push("availability");
  if (filters.addedInLastDays !== undefined && filters.addedInLastDays > 0) { active.push("addedInLastDays"); }
  if (filters.sort !== undefined) { active.push("sort"); }
  if (sectionPath === "new-homes-for-sale" && filters.openViewingsFrom !== undefined) {
    active.push("openViewingsFrom");
  }
  if (sectionPath === "new-homes-for-sale" && facilities.length > 0) {
    active.push("facilities");
  }
  if (sectionPath === "property-for-sale") {
    if (filters.floorSizeMinSqm !== undefined) { active.push("floorSizeMinSqm"); }
    if (filters.floorSizeMaxSqm !== undefined) { active.push("floorSizeMaxSqm"); }
    if (filters.berMin !== undefined) { active.push("berMin"); }
    if (filters.berMax !== undefined) { active.push("berMax"); }
    if (filters.saleType !== undefined) { active.push("saleType"); }
    if (filters.onlineOffers !== undefined) { active.push("onlineOffers"); }
    if (facilities.length > 0) { active.push("facilities"); }
  }
  if (sectionPath === "property-for-rent") {
    if (filters.leaseLengthMinMonths !== undefined) { active.push("leaseLengthMinMonths"); }
    if (filters.leaseLengthMaxMonths !== undefined) { active.push("leaseLengthMaxMonths"); }
    if (filters.furnishing !== undefined) { active.push("furnishing"); }
    if (facilities.length > 0) { active.push("facilities"); }
  }
  return active;
};

const nativePropertyTypeIds = (
  sectionPath: DaftSectionPath,
  propertyTypes: readonly DaftPropertyType[],
): readonly number[] | undefined => {
  const ids: number[] = [];
  for (const propertyType of propertyTypes) {
    const id = MYHOME_PROPERTY_TYPE_IDS[sectionPath][propertyType];
    if (id === undefined) { return undefined; }
    ids.push(id);
  }
  return ids;
};

const isNativeFilter = (
  sectionPath: DaftSectionPath,
  name: MyHomeFilterName,
  filters: DaftFilters,
): boolean => {
  if (name === "availability") {
    if (filters.availability === "published") { return true; }
    return sectionPath === "property-for-sale";
  }
  if (
    name === "priceMinEur" ||
    name === "priceMaxEur" ||
    name === "bedsMin" ||
    name === "bedsMax" ||
    name === "bathsMin" ||
    name === "keyword"
  ) {
    return true;
  }
  if (name === "propertyTypes") {
    return nativePropertyTypeIds(sectionPath, filters.propertyTypes) !== undefined;
  }
  return sectionPath === "property-for-sale" &&
    (name === "floorSizeMinSqm" || name === "floorSizeMaxSqm");
};

/** Reports which configured filters MyHome can enforce through its own search. */
export const validateMyHomeFilterSupport = (
  sectionPath: DaftSectionPath,
  filters: DaftFilters,
): MyHomeFilterSupport => {
  const supportedFilters: MyHomeFilterName[] = [];
  const unsupportedFilters: MyHomeFilterName[] = [];
  const filterSources: Partial<Record<MyHomeFilterName, MyHomeFilterSource>> = {};
  for (const name of activeFilterNames(sectionPath, filters)) {
    if (isNativeFilter(sectionPath, name, filters)) {
      supportedFilters.push(name);
      filterSources[name] = "native";
    } else {
      unsupportedFilters.push(name);
      filterSources[name] = "unsupported";
    }
  }
  return { supportedFilters, unsupportedFilters, filterSources };
};

/** Builds a MyHome search URL using every available provider-native query parameter. */
export const buildMyHomeSearchUrl = (
  baseUrl: string,
  canonicalPath: string,
  sectionPath: DaftSectionPath,
  filters: DaftFilters,
  page = 1,
): string => {
  const query = new URLSearchParams();
  const numericFilters = [
    ["minprice", filters.priceMinEur],
    ["maxprice", filters.priceMaxEur],
    ["minbeds", filters.bedsMin],
    ["maxbeds", filters.bedsMax],
    ["minbathrooms", filters.bathsMin],
    ["minsize", filters.floorSizeMinSqm],
    ["maxsize", filters.floorSizeMaxSqm],
  ] as const;
  for (const [name, value] of numericFilters) {
    if (value !== undefined) { query.set(name, String(value)); }
  }
  const propertyTypeIds = nativePropertyTypeIds(sectionPath, filters.propertyTypes);
  for (const id of propertyTypeIds ?? []) {
    query.append("propertytypeids", String(id));
  }
  const keyword = filters.keyword?.trim();
  if (keyword !== undefined && keyword !== "") { query.set("query", keyword); }
  return buildMyHomeUrl(baseUrl, canonicalPath, page, query);
};
