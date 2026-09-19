import {
  daftBerRatingValue,
  DAFT_RENT_FACILITIES,
  DAFT_SALE_FACILITIES,
  type DaftFacility,
  type DaftFilters,
} from "./filters.js";

export const DAFT_SECTION_PATHS = [
  "new-homes-for-sale",
  "property-for-sale",
  "property-for-rent",
] as const;
export type DaftSectionPath = (typeof DAFT_SECTION_PATHS)[number];

export type DaftSectionId =
  | "new-homes"
  | "property-sale"
  | "property-rent";
export type DaftPriceParameter = "salePrice" | "rentalPrice";

type FilterEncoder = (params: URLSearchParams, filters: DaftFilters) => void;

const addOptional = (
  params: URLSearchParams,
  name: string,
  value: string | number | boolean | undefined,
): void => {
  if (value !== undefined) {params.append(name, String(value));}
};

const appendRepeated = (
  params: URLSearchParams,
  name: string,
  values: readonly string[],
): void => {
  for (const value of values) {params.append(name, value);}
};

const encodeNewHomeFilters: FilterEncoder = (params, filters) => {
  addOptional(params, "viewingTimes_from", filters.openViewingsFrom);
};

const encodePropertySaleFilters: FilterEncoder = (params, filters) => {
  addOptional(params, "floorSize_from", filters.floorSizeMinSqm);
  addOptional(params, "floorSize_to", filters.floorSizeMaxSqm);
  addOptional(
    params,
    "simplifiedBer_from",
    daftBerRatingValue(filters.berMin),
  );
  addOptional(
    params,
    "simplifiedBer_to",
    daftBerRatingValue(filters.berMax),
  );
  addOptional(params, "saleType", filters.saleType);
  addOptional(
    params,
    "offersEnabledDisabled",
    filters.onlineOffers === undefined ? undefined : String(filters.onlineOffers),
  );
  appendRepeated(params, "facilities", filters.facilities ?? []);
};

const encodePropertyRentFilters: FilterEncoder = (params, filters) => {
  addOptional(params, "leaseLength_from", filters.leaseLengthMinMonths);
  addOptional(params, "leaseLength_to", filters.leaseLengthMaxMonths);
  addOptional(params, "furnishing", filters.furnishing);
  appendRepeated(params, "facilities", filters.facilities ?? []);
};

export interface DaftSectionDefinition {
  readonly id: DaftSectionId;
  readonly path: DaftSectionPath;
  readonly priceParameter: DaftPriceParameter;
  readonly defaultPriceMaxEur?: number;
  readonly supportsShps: boolean;
  readonly notificationTitlePrefix: string;
  readonly allowedFacilities: readonly DaftFacility[];
  readonly encodeFilters: FilterEncoder;
}

const definitions: Record<DaftSectionPath, DaftSectionDefinition> = {
  "new-homes-for-sale": {
    id: "new-homes",
    path: "new-homes-for-sale",
    priceParameter: "salePrice",
    defaultPriceMaxEur: 499_999,
    supportsShps: true,
    notificationTitlePrefix: "Bellwatch new home",
    allowedFacilities: [],
    encodeFilters: encodeNewHomeFilters,
  },
  "property-for-sale": {
    id: "property-sale",
    path: "property-for-sale",
    priceParameter: "salePrice",
    supportsShps: false,
    notificationTitlePrefix: "Bellwatch property sale",
    allowedFacilities: DAFT_SALE_FACILITIES,
    encodeFilters: encodePropertySaleFilters,
  },
  "property-for-rent": {
    id: "property-rent",
    path: "property-for-rent",
    priceParameter: "rentalPrice",
    supportsShps: false,
    notificationTitlePrefix: "Bellwatch rental",
    allowedFacilities: DAFT_RENT_FACILITIES,
    encodeFilters: encodePropertyRentFilters,
  },
};

export const DEFAULT_DAFT_SECTION_PATH: DaftSectionPath = "new-homes-for-sale";
export const DEFAULT_DAFT_SECTION = definitions[DEFAULT_DAFT_SECTION_PATH];

export const daftSectionForPath = (
  path: string,
): DaftSectionDefinition | undefined => {
  const sectionPath = DAFT_SECTION_PATHS.find((candidate) => candidate === path);
  return sectionPath === undefined ? undefined : definitions[sectionPath];
};
