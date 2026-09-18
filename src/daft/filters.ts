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
] as const;
export type DaftPropertyType = (typeof DAFT_PROPERTY_TYPES)[number];

const DAFT_PROPERTY_TYPE_LABELS: Record<
  DaftPropertyType,
  readonly string[]
> = {
  houses: [
    "bungalow",
    "detached",
    "end of terrace",
    "house",
    "houses",
    "semi",
    "semi d",
    "terrace",
    "townhouse",
  ],
  "detached-houses": ["detached"],
  "semi-detached-houses": ["semi", "semi d", "semi detached"],
  "terraced-houses": ["terrace"],
  "end-of-terrace-houses": ["end of terrace"],
  townhouses: ["townhouse"],
  apartments: ["apartment", "flat"],
  "studio-apartments": ["studio", "studio apartment"],
  duplexes: ["duplex"],
  bungalows: ["bungalow"],
};

const normalizePropertyType = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212-]/g, " ")
    .replace(/\s+/g, " ");

export const matchesDaftPropertyType = (
  propertyType: string | undefined,
  selectedTypes: readonly DaftPropertyType[],
): boolean => {
  if (selectedTypes.length === 0) return true;
  if (propertyType === undefined) return false;
  const normalized = normalizePropertyType(propertyType);
  return selectedTypes.some((selectedType) =>
    DAFT_PROPERTY_TYPE_LABELS[selectedType].includes(normalized),
  );
};

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
}

export const addedInLastDateValue = (
  days: DaftAddedInLastDays | undefined,
): string | undefined => (days === undefined || days === 0 ? undefined : `now-${days}d/d`);
