import type { DaftFilters, DaftPropertyType } from "../daft/filters.js";
import type { DaftSectionPath } from "../daft/sections.js";
import { buildMyHomeUrl, canonicalMyHomePath } from "./urls.js";
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
