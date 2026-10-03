import {
  daftBerRatingValue,
  DAFT_FACILITIES,
  DAFT_RENT_FACILITIES,
  DAFT_SALE_FACILITIES,
  type DaftBerRating,
  type DaftFacility,
  type DaftFilters,
  type DaftFurnishing,
  type DaftPropertyType,
} from "./daft/filters.js";
import type { DaftSectionPath } from "./daft/sections.js";
import type { DaftFinding } from "./daft/parser.js";
import { sourcedFindingKey, type SourcedFinding } from "./listings.js";

interface HtmlElement {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: (HtmlElement | string)[];
  readonly parent?: HtmlElement;
}

const VOID_TAGS: Readonly<Record<string, true>> = {
  area: true,
  base: true,
  br: true,
  col: true,
  embed: true,
  hr: true,
  img: true,
  input: true,
  link: true,
  meta: true,
  param: true,
  source: true,
  track: true,
  wbr: true,
};
const SECTION_SEARCH_ROUTES: Readonly<Record<
  DaftSectionPath,
  {
    readonly nationalPath: string;
    readonly locationRoot: "residential" | "rentals";
    readonly genericSuffix: string;
    readonly houseSuffix: string;
  }
>> = {
  "new-homes-for-sale": {
    nationalPath: "/residential/ireland/new-homes/property-for-sale",
    locationRoot: "residential",
    genericSuffix: "/new-homes/property-for-sale",
    houseSuffix: "/new-homes/house-for-sale",
  },
  "property-for-sale": {
    nationalPath: "/residential/ireland/property-for-sale",
    locationRoot: "residential",
    genericSuffix: "/property-for-sale",
    houseSuffix: "/house-for-sale",
  },
  "property-for-rent": {
    nationalPath: "/rentals/ireland/property-to-rent",
    locationRoot: "rentals",
    genericSuffix: "/property-to-rent",
    houseSuffix: "/house-to-rent",
  },
};
export const getMyHomeNationalSearchPath = (sectionPath: DaftSectionPath): string =>
  SECTION_SEARCH_ROUTES[sectionPath].nationalPath;

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
export type MyHomeFilterSource = "source-backed-local" | "unsupported";

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

export interface MyHomeFinding extends SourcedFinding {
  readonly source: "myhome";
  readonly myhomeEvidence: MyHomeEvidence;
}

export interface MyHomeListPage {
  readonly findings: MyHomeFinding[];
  readonly currentPage: number;
  readonly totalPages: number;
}

export interface MyHomeDetail
  extends Partial<Omit<DaftFinding, "id" | "url" | "priceText">> {
  readonly sourceId: string;
  readonly url: string;
  readonly priceText?: string;
  readonly myhomeEvidence: MyHomeEvidence;
  readonly latitude?: number;
  readonly longitude?: number;
}

export interface MyHomeFilterResult {
  readonly findings: MyHomeFinding[];
  readonly unsupportedFilters: readonly MyHomeFilterName[];
  readonly unverifiedSourceIds: readonly string[];
  readonly filterSources: Readonly<Partial<Record<MyHomeFilterName, MyHomeFilterSource>>>;
}

const decodeHtml = (value: string): string =>
  value.replace(
    /&(?:#(?:x[\da-f]+|\d+)|nbsp|amp|lt|gt|quot|apos|euro);/gi,
    (entity) => {
      const normalized = entity.toLowerCase();
      if (normalized === "&nbsp;") { return " "; }
      if (normalized === "&amp;") { return "&"; }
      if (normalized === "&lt;") { return "<"; }
      if (normalized === "&gt;") { return ">"; }
      if (normalized === "&quot;") { return '"'; }
      if (normalized === "&apos;") { return "'"; }
      if (normalized === "&euro;") { return "€"; }
      const digits = normalized.startsWith("&#x")
        ? Number.parseInt(normalized.slice(3, -1), 16)
        : Number.parseInt(normalized.slice(2, -1), 10);
      return Number.isInteger(digits) && digits > 0 && digits <= 0x10ffff
        ? String.fromCodePoint(digits)
        : entity;
    },
  );

const parseAttributes = (source: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1]?.toLowerCase();
    if (name === undefined || Object.hasOwn(attributes, name)) { continue; }
    attributes[name] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
};

const parseHtml = (html: string): HtmlElement => {
  const root: HtmlElement = { tag: "#root", attributes: {}, children: [] };
  const stack: HtmlElement[] = [root];
  let rawTag: string | undefined;
  const tokens = html.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+|</g);
  for (const match of tokens) {
    const token = match[0];
    if (rawTag !== undefined) {
      if (token.toLowerCase().startsWith(`</${rawTag}`)) { rawTag = undefined; }
      continue;
    }
    if (!token.startsWith("<") || token.startsWith("<!--") || token.startsWith("<!")) {
      stack.at(-1)?.children.push(decodeHtml(token));
      continue;
    }
    if (token.startsWith("</")) {
      const name = /^<\/\s*([a-zA-Z][\w:-]*)/.exec(token)?.[1]?.toLowerCase();
      if (name === undefined) { continue; }
      const index = stack.findLastIndex((element) => element.tag === name);
      if (index > 0) { stack.length = index; }
      continue;
    }
    const matchTag = /^<\s*([a-zA-Z][\w:-]*)\b([\s\S]*?)\/?\s*>$/.exec(token);
    const name = matchTag?.[1]?.toLowerCase();
    if (name === undefined) { continue; }
    const parent = stack.at(-1);
    const element: HtmlElement = {
      tag: name,
      attributes: parseAttributes(matchTag?.[2] ?? ""),
      children: [],
      ...(parent === undefined ? {} : { parent }),
    };
    parent?.children.push(element);
    if (name === "script" || name === "style") {
      rawTag = name;
    } else if (VOID_TAGS[name] !== true && !/\/\s*>$/.test(token)) {
      stack.push(element);
    }
  }
  return root;
};

function* descendants(element: HtmlElement): Generator<HtmlElement> {
  for (const child of element.children) {
    if (typeof child !== "string") {
      yield child;
      yield* descendants(child);
    }
  }
}

const elementText = (element: HtmlElement): string => {
  let text = "";
  for (const child of element.children) {
    text += typeof child === "string" ? child : elementText(child);
    text += " ";
  }
  return text.replace(/\s+/g, " ").trim();
};

const attribute = (element: HtmlElement, name: string): string | undefined => {
  const value = element.attributes[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
};

const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();

const firstElementText = (
  root: HtmlElement,
  predicate: (element: HtmlElement) => boolean,
): string | undefined => {
  for (const element of descendants(root)) {
    if (predicate(element)) {
      const value = attribute(element, "content") ?? elementText(element);
      if (value !== "") { return value; }
    }
  }
  return undefined;
};

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

/** Builds canonical residential or rental URLs with optional page-only pagination. */
export const buildMyHomeUrl = (
  baseUrl: string,
  canonicalPath: string,
  page = 1,
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
  if (page > 1) { url.search = `?page=${page}`; }
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
  if (locations.length > 1) { unsupportedLocationFilters.push("locations"); }
  if (unsupportedLocationFilters.length > 0) {
    return { unsupportedLocationFilters };
  }
  if (locations.length === 0) {
    return {
      searchPath: SECTION_SEARCH_ROUTES[sectionPath].nationalPath,
      unsupportedLocationFilters,
    };
  }
  const location = locations[0];
  if (location === undefined || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(location)) {
    return { unsupportedLocationFilters: ["locations"] };
  }
  const routes = SECTION_SEARCH_ROUTES[sectionPath];
  const locationPrefix = `/${routes.locationRoot}/${location}`;
  const genericPath = `${locationPrefix}${routes.genericSuffix}`;
  const housePath = `${locationPrefix}${routes.houseSuffix}`;
  const evidencedRoutes: Record<string, true> = {};
  for (const route of confirmedRegionRoutes) {
    const canonical = canonicalMyHomePath(route);
    if (canonical !== undefined) { evidencedRoutes[canonical] = true; }
  }
  if (evidencedRoutes[genericPath] === true) {
    return { searchPath: genericPath, unsupportedLocationFilters };
  }
  const houseOnly = filters.propertyTypes.length > 0 &&
    filters.propertyTypes.every((type) => HOUSE_PROPERTY_TYPES[type] === true);
  if (houseOnly && evidencedRoutes[housePath] === true) {
    return { searchPath: housePath, unsupportedLocationFilters };
  }
  return { unsupportedLocationFilters: ["locations"] };
};

const pageNumberFromUrl = (url: URL): number => {
  if (url.hash !== "") { throw new Error("MyHome page URLs must not contain fragments"); }
  if (url.search === "") { return 1; }
  const match = /^\?page=([1-9]\d*)$/.exec(url.search);
  const page = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error("MyHome pages may use only the single ?page=N query parameter");
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
  const canonicalPageUrl = new URL(buildMyHomeUrl(base.toString(), pagePath.canonicalPath, currentPage));
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
      finding: {
        id: sourcedFindingKey({ source: "myhome", sourceId }),
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
  const rating = value.trim().replace(/^ber\s*:?\s*/i, "").toUpperCase();
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
  finding: SourcedFinding,
  detail: MyHomeDetail,
): MyHomeFinding => {
  if (finding.source !== "myhome") { throw new Error("Only MyHome findings can be enriched with MyHome details"); }
  if (finding.sourceId !== detail.sourceId) {
    throw new Error(`MyHome detail ID ${detail.sourceId} does not match source ID ${finding.sourceId}`);
  }
  const title = detail.title ?? finding.finding.title;
  const enriched: DaftFinding = {
    id: sourcedFindingKey(finding),
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
    finding: enriched,
    myhomeEvidence: detail.myhomeEvidence,
    ...(detail.latitude === undefined ? {} : { latitude: detail.latitude }),
    ...(detail.longitude === undefined ? {} : { longitude: detail.longitude }),
  };
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

const staticallyUnsupported = (
  sectionPath: DaftSectionPath,
  name: MyHomeFilterName,
  filters: DaftFilters,
): boolean => {
  const facilities = filters.facilities ?? [];
  if (name === "radiusKm" || name === "mediaTypes") { return true; }
  if (name === "sort" && filters.sort === "bestMatch") { return true; }
  if (name !== "facilities") { return false; }
  const allowed: readonly DaftFacility[] = sectionPath === "property-for-sale"
    ? DAFT_SALE_FACILITIES
    : sectionPath === "property-for-rent"
      ? DAFT_RENT_FACILITIES
      : [];
  return facilities.some((facility) => !allowed.includes(facility));
};

/** Reports local source-backed filters and rejects any active feature MyHome cannot enforce. */
export const validateMyHomeFilterSupport = (
  sectionPath: DaftSectionPath,
  filters: DaftFilters,
): MyHomeFilterSupport => {
  const supportedFilters: MyHomeFilterName[] = [];
  const unsupportedFilters: MyHomeFilterName[] = [];
  const filterSources: Partial<Record<MyHomeFilterName, MyHomeFilterSource>> = {};
  for (const name of activeFilterNames(sectionPath, filters)) {
    if (staticallyUnsupported(sectionPath, name, filters)) {
      unsupportedFilters.push(name);
      filterSources[name] = "unsupported";
    } else {
      supportedFilters.push(name);
      filterSources[name] = "source-backed-local";
    }
  }
  return { supportedFilters, unsupportedFilters, filterSources };
};

const unknownFor = (
  evidence: MyHomeEvidence,
  finding: DaftFinding,
  filters: DaftFilters,
  sectionPath: DaftSectionPath,
): MyHomeFilterName[] => {
  const facilities = filters.facilities ?? [];
  const unknown: MyHomeFilterName[] = [];
  if (filters.priceMinEur !== undefined || filters.priceMaxEur !== undefined) {
    if (evidence.priceState === "unknown") {
      unknown.push(...[
        ...(filters.priceMinEur === undefined ? [] : ["priceMinEur" as const]),
        ...(filters.priceMaxEur === undefined ? [] : ["priceMaxEur" as const]),
      ]);
    }
  }
  if ((filters.bedsMin !== undefined || filters.bedsMax !== undefined) && finding.bedrooms === undefined) {
    if (filters.bedsMin !== undefined) { unknown.push("bedsMin"); }
    if (filters.bedsMax !== undefined) { unknown.push("bedsMax"); }
  }
  if ((filters.bathsMin !== undefined || filters.bathsMax !== undefined) && finding.bathrooms === undefined) {
    if (filters.bathsMin !== undefined) { unknown.push("bathsMin"); }
    if (filters.bathsMax !== undefined) { unknown.push("bathsMax"); }
  }
  if (filters.propertyTypes.length > 0 && evidence.daftPropertyTypes.length === 0) {
    unknown.push("propertyTypes");
  }
  if (filters.keyword !== undefined && filters.keyword.trim() !== "" && evidence.searchableText === "") {
    unknown.push("keyword");
  }
  if (evidence.availability === undefined) { unknown.push("availability"); }
  if (filters.addedInLastDays !== undefined && filters.addedInLastDays > 0 && evidence.publishedAt === undefined) {
    unknown.push("addedInLastDays");
  }
  if (sectionPath === "new-homes-for-sale" && filters.openViewingsFrom !== undefined && !evidence.openViewingsVerified) {
    unknown.push("openViewingsFrom");
  }
  if (sectionPath === "property-for-sale") {
    if ((filters.floorSizeMinSqm !== undefined || filters.floorSizeMaxSqm !== undefined) && finding.floorSizeSqm === undefined) {
      if (filters.floorSizeMinSqm !== undefined) { unknown.push("floorSizeMinSqm"); }
      if (filters.floorSizeMaxSqm !== undefined) { unknown.push("floorSizeMaxSqm"); }
    }
    if ((filters.berMin !== undefined || filters.berMax !== undefined) && finding.berRating === undefined) {
      if (filters.berMin !== undefined) { unknown.push("berMin"); }
      if (filters.berMax !== undefined) { unknown.push("berMax"); }
    }
    if (filters.saleType !== undefined && !evidence.saleTypeVerified) { unknown.push("saleType"); }
    if (filters.onlineOffers !== undefined && !evidence.onlineOffersVerified) { unknown.push("onlineOffers"); }
    if (facilities.length > 0 && !evidence.facilitiesVerified) { unknown.push("facilities"); }
  }
  if (sectionPath === "property-for-rent") {
    if ((filters.leaseLengthMinMonths !== undefined || filters.leaseLengthMaxMonths !== undefined) && evidence.leaseLengthMonths === undefined) {
      if (filters.leaseLengthMinMonths !== undefined) { unknown.push("leaseLengthMinMonths"); }
      if (filters.leaseLengthMaxMonths !== undefined) { unknown.push("leaseLengthMaxMonths"); }
    }
    if (filters.furnishing !== undefined && evidence.furnishing === undefined) { unknown.push("furnishing"); }
    if (facilities.length > 0 && !evidence.facilitiesVerified) { unknown.push("facilities"); }
  }
  if (
    (filters.sort === "publishDateDesc" && evidence.publishedAt === undefined) ||
    ((filters.sort === "priceAsc" || filters.sort === "priceDesc") && evidence.priceState !== "amount")
  ) {
    unknown.push("sort");
  }
  return unknown;
};

const publishedWithinDays = (
  value: string,
  days: number,
  now: Date,
): boolean => {
  const published = Date.parse(value);
  if (Number.isNaN(published) || Number.isNaN(now.getTime())) { return false; }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return published >= today - days * 86_400_000;
};

const matchesFilters = (
  finding: MyHomeFinding,
  sectionPath: DaftSectionPath,
  filters: DaftFilters,
  now: Date,
): boolean => {
  const facilities = filters.facilities ?? [];
  const { finding: property, myhomeEvidence: evidence } = finding;
  if (filters.priceMinEur !== undefined && (evidence.priceEur ?? -1) < filters.priceMinEur) { return false; }
  if (filters.priceMaxEur !== undefined && (evidence.priceEur ?? Number.POSITIVE_INFINITY) > filters.priceMaxEur) { return false; }
  if (filters.bedsMin !== undefined && (property.bedrooms ?? -1) < filters.bedsMin) { return false; }
  if (filters.bedsMax !== undefined && (property.bedrooms ?? Number.POSITIVE_INFINITY) > filters.bedsMax) { return false; }
  if (filters.bathsMin !== undefined && (property.bathrooms ?? -1) < filters.bathsMin) { return false; }
  if (filters.bathsMax !== undefined && (property.bathrooms ?? Number.POSITIVE_INFINITY) > filters.bathsMax) { return false; }
  if (filters.propertyTypes.length > 0 && !filters.propertyTypes.some((type) => evidence.daftPropertyTypes.includes(type))) { return false; }
  if (filters.keyword !== undefined && !normalize(evidence.searchableText).includes(normalize(filters.keyword))) { return false; }
  if (evidence.availability !== filters.availability) { return false; }
  if (
    filters.addedInLastDays !== undefined &&
    filters.addedInLastDays > 0 &&
    evidence.publishedAt !== undefined &&
    !publishedWithinDays(evidence.publishedAt, filters.addedInLastDays, now)
  ) { return false; }
  const openViewingsFrom = filters.openViewingsFrom;
  if (
    sectionPath === "new-homes-for-sale" &&
    openViewingsFrom !== undefined &&
    !evidence.openViewingDates.some((date) => date >= openViewingsFrom)
  ) { return false; }
  if (sectionPath === "property-for-sale") {
    if (filters.floorSizeMinSqm !== undefined && (property.floorSizeSqm ?? -1) < filters.floorSizeMinSqm) { return false; }
    if (filters.floorSizeMaxSqm !== undefined && (property.floorSizeSqm ?? Number.POSITIVE_INFINITY) > filters.floorSizeMaxSqm) { return false; }
    const rating = daftBerRatingValue(
      property.berRating === undefined ? undefined : parseBer(property.berRating),
    );
    const minimumBer = daftBerRatingValue(filters.berMin);
    const maximumBer = daftBerRatingValue(filters.berMax);
    if (minimumBer !== undefined && (rating ?? -1) < minimumBer) { return false; }
    if (maximumBer !== undefined && (rating ?? Number.POSITIVE_INFINITY) > maximumBer) { return false; }
    if (filters.saleType === "auction" && evidence.saleType !== "auction") { return false; }
    if (filters.onlineOffers !== undefined && evidence.onlineOffers !== filters.onlineOffers) { return false; }
    if (facilities.some((facility) => !evidence.facilities.includes(facility))) { return false; }
  }
  if (sectionPath === "property-for-rent") {
    if (filters.leaseLengthMinMonths !== undefined && (evidence.leaseLengthMonths ?? -1) < filters.leaseLengthMinMonths) { return false; }
    if (filters.leaseLengthMaxMonths !== undefined && (evidence.leaseLengthMonths ?? Number.POSITIVE_INFINITY) > filters.leaseLengthMaxMonths) { return false; }
    if (filters.furnishing !== undefined && evidence.furnishing !== filters.furnishing) { return false; }
    if (facilities.some((facility) => !evidence.facilities.includes(facility))) { return false; }
  }
  return true;
};

const sortFindings = (
  findings: MyHomeFinding[],
  sort: DaftFilters["sort"],
): MyHomeFinding[] => {
  if (sort === undefined || sort === "bestMatch") { return findings; }
  return findings.sort((left, right) => {
    const comparison = sort === "publishDateDesc"
      ? Date.parse(right.myhomeEvidence.publishedAt ?? "") - Date.parse(left.myhomeEvidence.publishedAt ?? "")
      : (left.myhomeEvidence.priceEur ?? 0) - (right.myhomeEvidence.priceEur ?? 0);
    return sort === "priceDesc" ? -comparison : comparison;
  });
};

const isMyHomeFinding = (item: SourcedFinding): item is MyHomeFinding =>
  item.source === "myhome" &&
  "myhomeEvidence" in item &&
  typeof item.myhomeEvidence === "object" &&
  item.myhomeEvidence !== null &&
  "typeVerified" in item.myhomeEvidence &&
  typeof item.myhomeEvidence.typeVerified === "boolean";

/** Applies locally supported semantics and fails closed with explicit unsupported filters. */
export const applyMyHomeFilters = (
  findings: readonly SourcedFinding[],
  sectionPath: DaftSectionPath,
  filters: DaftFilters,
  now = new Date(),
): MyHomeFilterResult => {
  const support = validateMyHomeFilterSupport(sectionPath, filters);
  const unverifiedSourceIds = new Set<string>();
  for (const item of findings) {
    if (item.source !== "myhome") { throw new Error("MyHome filters accept only MyHome findings"); }
    if (!isMyHomeFinding(item) || !item.myhomeEvidence.typeVerified) {
      unverifiedSourceIds.add(item.sourceId);
    }
  }
  if (support.unsupportedFilters.length > 0) {
    return {
      findings: [],
      unsupportedFilters: support.unsupportedFilters,
      unverifiedSourceIds: [...unverifiedSourceIds],
      filterSources: support.filterSources,
    };
  }
  const applicable: MyHomeFinding[] = [];
  for (const item of findings) {
    if (!isMyHomeFinding(item) || !item.myhomeEvidence.typeVerified) {
      unverifiedSourceIds.add(item.sourceId);
      continue;
    }
    if (unknownFor(item.myhomeEvidence, item.finding, filters, sectionPath).length > 0) {
      unverifiedSourceIds.add(item.sourceId);
      continue;
    }
    if (matchesFilters(item, sectionPath, filters, now)) { applicable.push(item); }
  }
  return {
    findings: sortFindings(applicable, filters.sort),
    unsupportedFilters: [],
    unverifiedSourceIds: [...unverifiedSourceIds],
    filterSources: support.filterSources,
  };
};
