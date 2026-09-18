export const DAFT_RADIUS_KM_OPTIONS = [0, 1, 3, 5, 10, 20] as const;
export type DaftRadiusKm = (typeof DAFT_RADIUS_KM_OPTIONS)[number];

export const DAFT_PROPERTY_TYPES = [
  "houses",
  "detached-houses",
  "semi-detached-houses",
  "terraced-houses",
  "end-of-terrace-houses",
  "townhouses",
  "apartments",
  "studio-apartments",
  "duplexes",
  "bungalows",
  "sites",
] as const;
export type DaftPropertyType = (typeof DAFT_PROPERTY_TYPES)[number];

export const DAFT_MEDIA_TYPES = ["video", "virtual-tour"] as const;
export type DaftMediaType = (typeof DAFT_MEDIA_TYPES)[number];

export const DAFT_AVAILABILITIES = ["published", "sale-agreed"] as const;
export type DaftAvailability = (typeof DAFT_AVAILABILITIES)[number];

export const DAFT_ADDED_IN_LAST_DAYS = [0, 1, 3, 7, 14, 30] as const;
export type DaftAddedInLastDays = (typeof DAFT_ADDED_IN_LAST_DAYS)[number];

export const DAFT_SORTS = [
  "bestMatch",
  "publishDateDesc",
  "priceAsc",
  "priceDesc",
] as const;
export type DaftSort = (typeof DAFT_SORTS)[number];

export const DAFT_LEASE_LENGTH_MONTHS = [3, 6, 9, 12, 24, 36] as const;
export type DaftLeaseLengthMonths =
  (typeof DAFT_LEASE_LENGTH_MONTHS)[number];

export const DAFT_FURNISHINGS = ["furnished", "unfurnished"] as const;
export type DaftFurnishing = (typeof DAFT_FURNISHINGS)[number];

export const DAFT_FACILITIES = [
  "alarm",
  "cable-television",
  "central-heating",
  "dishwasher",
  "dryer",
  "garden-patio-balcony",
  "gas-fired-central-heating",
  "internet",
  "microwave",
  "oil-fired-central-heating",
  "parking",
  "pets-allowed",
  "serviced-property",
  "smoking",
  "washing-machine",
  "wheelchair-access",
  "wired-for-cable-television",
] as const;
export type DaftFacility = (typeof DAFT_FACILITIES)[number];

export const DAFT_RENT_FACILITIES = [
  "alarm",
  "cable-television",
  "central-heating",
  "dishwasher",
  "dryer",
  "garden-patio-balcony",
  "internet",
  "microwave",
  "parking",
  "pets-allowed",
  "serviced-property",
  "smoking",
  "washing-machine",
  "wheelchair-access",
] as const satisfies readonly DaftFacility[];

export const DAFT_SALE_FACILITIES = [
  "alarm",
  "gas-fired-central-heating",
  "oil-fired-central-heating",
  "parking",
  "wheelchair-access",
  "wired-for-cable-television",
] as const satisfies readonly DaftFacility[];

export const DAFT_BER_RATINGS = [
  "exempt",
  "G",
  "F",
  "E",
  "D",
  "C",
  "B",
  "A",
  "A0",
] as const;
export type DaftBerRating = (typeof DAFT_BER_RATINGS)[number];

export const daftBerRatingValue = (
  rating: DaftBerRating | undefined,
): number | undefined => {
  if (rating === undefined) return undefined;
  return DAFT_BER_RATINGS.indexOf(rating);
};

export const DAFT_SALE_TYPES = ["auction"] as const;
export type DaftSaleType = (typeof DAFT_SALE_TYPES)[number];

export interface DaftFilters {
  readonly radiusKm?: DaftRadiusKm;
  readonly priceMinEur?: number;
  readonly priceMaxEur?: number;
  readonly bedsMin?: number;
  readonly bedsMax?: number;
  readonly propertyTypes: readonly DaftPropertyType[];
  readonly bathsMin?: number;
  readonly bathsMax?: number;
  readonly mediaTypes: readonly DaftMediaType[];
  readonly keyword?: string;
  readonly availability: DaftAvailability;
  readonly addedInLastDays?: DaftAddedInLastDays;
  readonly openViewingsFrom?: string;
  readonly sort?: DaftSort;
  readonly facilities?: readonly DaftFacility[];
  readonly leaseLengthMinMonths?: DaftLeaseLengthMonths;
  readonly leaseLengthMaxMonths?: DaftLeaseLengthMonths;
  readonly furnishing?: DaftFurnishing;
  readonly floorSizeMinSqm?: number;
  readonly floorSizeMaxSqm?: number;
  readonly berMin?: DaftBerRating;
  readonly berMax?: DaftBerRating;
  readonly saleType?: DaftSaleType;
  readonly onlineOffers?: boolean;
}

export const addedInLastDateValue = (
  days: DaftAddedInLastDays | undefined,
): string | undefined => (days === undefined || days === 0 ? undefined : `now-${days}d/d`);
