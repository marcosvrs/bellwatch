import {
  DEFAULT_DAFT_SECTION_PATH,
  daftSectionForPath,
  type DaftSectionPath,
} from "./sections.js";
import {
  parseListingFloorSize,
  type DaftSoldComparison,
} from "./sold.js";

export interface DaftFinding {
  readonly id: string;
  readonly title: string;
  readonly developmentTitle: string;
  readonly priceText: string;
  readonly bedrooms?: number;
  readonly bathrooms?: number;
  readonly propertyType?: string;
  readonly floorSizeSqm?: number;
  readonly berRating?: string;
  readonly address?: string;
  readonly eircode?: string;
  readonly soldComparison?: DaftSoldComparison;
  readonly url: string;
  readonly schemeText?: string;
}

export interface DaftListingDetails {
  readonly schemeText?: string;
  readonly floorSizeSqm?: number;
  readonly berRating?: string;
  readonly address?: string;
  readonly eircode?: string;
}

interface DaftPageResult {
  readonly findings: readonly DaftFinding[];
  readonly currentPage: number;
  readonly totalPages: number;
}

type JsonRecord = Record<string, unknown>;
type ListingParser = (value: unknown, baseUrl: string) => DaftFinding[];

const asRecord = (value: unknown): JsonRecord | undefined =>
  typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;

const stringValue = (
  record: JsonRecord | undefined,
  key: string,
): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const numberValue = (
  record: JsonRecord | undefined,
  key: string,
): number | undefined => {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return undefined;
};

const identifier = (record: JsonRecord | undefined): string | undefined => {
  const numeric = numberValue(record, "id");
  if (numeric !== undefined) return String(numeric);
  return stringValue(record, "id");
};

const parseCount = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : undefined;
};

const absoluteUrl = (
  baseUrl: string,
  path: string | undefined,
  id: string,
  fallbackPath: string,
): string => new URL(path ?? `${fallbackPath}/listing/${id}`, baseUrl).toString();

export const parseDaftListingDetails = (
  payload: unknown,
): DaftListingDetails => {
  const root = asRecord(payload);
  const props = asRecord(root?.props);
  const pageProps = asRecord(props?.pageProps) ?? root ?? {};
  const listing = asRecord(pageProps.listing);
  const newHome = asRecord(listing?.newHome);
  const addressDetails = asRecord(listing?.addressDetails);
  const description = stringValue(listing, "description");
  const schemeText =
    description === undefined
      ? undefined
      : [
          stringValue(listing, "title"),
          stringValue(newHome, "tagLine"),
          description,
        ]
          .filter((value): value is string => value !== undefined)
          .join("\n") || undefined;
  const floorSizeSqm = parseListingFloorSize(listing);
  const berRating = stringValue(asRecord(listing?.ber), "rating");
  const address = stringValue(addressDetails, "streetAddress");
  const eircode = stringValue(addressDetails, "postalCode");
  const details: DaftListingDetails = {
    ...(schemeText === undefined ? {} : { schemeText }),
    ...(floorSizeSqm === undefined ? {} : { floorSizeSqm }),
    ...(berRating === undefined ? {} : { berRating }),
    ...(address === undefined ? {} : { address }),
    ...(eircode === undefined ? {} : { eircode }),
  };
  return Object.keys(details).length === 0
    ? { schemeText: undefined }
    : details;
};

const unitTitle = (
  developmentTitle: string,
  unit: JsonRecord,
): string => {
  const details = [
    stringValue(unit, "numBedrooms"),
    stringValue(unit, "numBathrooms"),
    stringValue(unit, "propertyType"),
  ].filter(Boolean);
  return details.length > 0
    ? `${developmentTitle} — ${details.join(" · ")}`
    : developmentTitle;
};

interface FindingOverrides {
  readonly id?: string;
  readonly title?: string;
  readonly developmentTitle?: string;
}

const parseFinding = (
  listing: JsonRecord,
  baseUrl: string,
  fallbackPath: string,
  overrides: FindingOverrides = {},
): DaftFinding | undefined => {
  const id = overrides.id ?? identifier(listing);
  if (id === undefined) return undefined;
  const title =
    overrides.title ??
    stringValue(listing, "title") ??
    `Daft listing ${id}`;
  const developmentTitle =
    overrides.developmentTitle ?? stringValue(listing, "title") ?? title;
  const bedrooms = parseCount(stringValue(listing, "numBedrooms"));
  const bathrooms = parseCount(stringValue(listing, "numBathrooms"));
  const propertyType = stringValue(listing, "propertyType");
  const floorSizeSqm = parseListingFloorSize(listing);
  const berRating = stringValue(asRecord(listing.ber), "rating");
  const addressDetails = asRecord(listing.addressDetails);
  const address = stringValue(addressDetails, "streetAddress");
  const eircode = stringValue(addressDetails, "postalCode");
  return {
    id,
    title,
    developmentTitle,
    priceText: stringValue(listing, "price") ?? "Price unavailable",
    ...(bedrooms === undefined ? {} : { bedrooms }),
    ...(bathrooms === undefined ? {} : { bathrooms }),
    ...(propertyType === undefined ? {} : { propertyType }),
    ...(floorSizeSqm === undefined ? {} : { floorSizeSqm }),
    ...(berRating === undefined ? {} : { berRating }),
    ...(address === undefined ? {} : { address }),
    ...(eircode === undefined ? {} : { eircode }),
    url: absoluteUrl(
      baseUrl,
      stringValue(listing, "seoFriendlyPath"),
      id,
      fallbackPath,
    ),
  };
};

const listingRecord = (value: unknown): JsonRecord | undefined =>
  asRecord(asRecord(value)?.listing);

const parseNewHomeListing: ListingParser = (value, baseUrl) => {
  const listing = listingRecord(value);
  if (!listing) return [];
  const parentId = identifier(listing);
  if (parentId === undefined) return [];
  const newHome = asRecord(listing.newHome);
  const developmentTitle =
    stringValue(newHome, "developmentName") ??
    stringValue(listing, "title") ??
    `Daft development ${parentId}`;
  const units = Array.isArray(newHome?.subUnits) ? newHome.subUnits : [];

  if (units.length === 0) {
    const finding = parseFinding(
      listing,
      baseUrl,
      "/new-home-for-sale",
      { id: parentId, title: developmentTitle, developmentTitle },
    );
    return finding ? [finding] : [];
  }

  return units.flatMap((value) => {
    const unit = asRecord(value);
    if (!unit) return [];
    const id = identifier(unit);
    if (id === undefined) return [];
    const finding = parseFinding(
      unit,
      baseUrl,
      "/new-home-for-sale",
      {
        id,
        title: unitTitle(developmentTitle, unit),
        developmentTitle,
      },
    );
    return finding ? [finding] : [];
  });
};

const parseDirectListing = (
  value: unknown,
  baseUrl: string,
  fallbackPath: string,
): DaftFinding[] => {
  const listing = listingRecord(value) ?? asRecord(value);
  if (!listing) return [];
  const finding = parseFinding(listing, baseUrl, fallbackPath);
  return finding ? [finding] : [];
};

const parsePropertySaleListing: ListingParser = (value, baseUrl) =>
  parseDirectListing(value, baseUrl, "/for-sale");

const parsePropertyRentListing: ListingParser = (value, baseUrl) => {
  const listing = listingRecord(value);
  if (!listing) return [];
  const prs = asRecord(listing.prs);
  const units = Array.isArray(prs?.subUnits) ? prs.subUnits : [];
  if (units.length === 0) {
    const finding = parseFinding(listing, baseUrl, "/for-rent");
    return finding ? [finding] : [];
  }

  const parentId = identifier(listing);
  const developmentTitle =
    stringValue(listing, "title") ??
    (parentId === undefined ? "Daft rental" : `Daft rental ${parentId}`);
  return units.flatMap((value) => {
    const unit = asRecord(value);
    if (!unit) return [];
    const id = identifier(unit);
    if (id === undefined) return [];
    const finding = parseFinding(
      unit,
      baseUrl,
      "/for-rent",
      {
        id,
        title: unitTitle(developmentTitle, unit),
        developmentTitle,
      },
    );
    return finding ? [finding] : [];
  });
};

const listingParsers: Record<DaftSectionPath, ListingParser> = {
  "new-homes-for-sale": parseNewHomeListing,
  "property-for-sale": parsePropertySaleListing,
  "property-for-rent": parsePropertyRentListing,
};

export const parseDaftPage = (
  payload: unknown,
  baseUrl: string,
  sectionPath: string = DEFAULT_DAFT_SECTION_PATH,
): DaftPageResult => {
  const root = asRecord(payload);
  const props = asRecord(root?.props);
  const pageProps = asRecord(props?.pageProps) ?? root ?? {};
  const parser =
    listingParsers[daftSectionForPath(sectionPath)?.path ?? DEFAULT_DAFT_SECTION_PATH];
  const seen = new Set<string>();
  const findings: DaftFinding[] = [];
  if (Array.isArray(pageProps.listings)) {
    for (const listing of pageProps.listings) {
      for (const finding of parser(listing, baseUrl)) {
        if (seen.has(finding.id)) continue;
        seen.add(finding.id);
        findings.push(finding);
      }
    }
  }

  const paging = asRecord(pageProps.paging);
  const currentPage = numberValue(paging, "currentPage") ?? 1;
  const totalPages = numberValue(paging, "totalPages") ?? currentPage;
  return {
    findings,
    currentPage,
    totalPages,
  };
};
