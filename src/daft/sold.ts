import type { DaftFinding } from "./parser.js";
import { DAFT_BER_RATINGS, type DaftBerRating } from "./filters.js";

export type DaftSoldVerdict = "above" | "within" | "below" | "unavailable";

export interface DaftSoldComparison {
  readonly year: number;
  readonly comparableCount: number;
  readonly minPriceEur?: number;
  readonly maxPriceEur?: number;
  readonly askingPriceEur?: number;
  readonly verdict?: DaftSoldVerdict;
}

export interface DaftSoldSearchRequest {
  readonly baseUrl: string;
  readonly locations: readonly string[];
  readonly finding: Pick<
    DaftFinding,
    | "address"
    | "berRating"
    | "bedrooms"
    | "bathrooms"
    | "eircode"
    | "floorSizeSqm"
    | "propertyType"
  > &
    Partial<Pick<DaftFinding, "priceText">>;
  readonly year: number;
}

export interface DaftSoldPageResult {
  readonly prices: readonly number[];
  readonly currentPage: number;
  readonly totalPages: number;
}

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | undefined =>
  typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;


const numberValue = (
  record: JsonRecord | undefined,
  key: string,
): number | undefined => {
  const value = record?.[key];
  if (Number.isFinite(value)) return value as number;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return undefined;
};

export const parseDaftMoney = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replaceAll(/\s/g, "");
  const multiplier = normalized.endsWith("m")
    ? 1_000_000
    : normalized.endsWith("k")
      ? 1_000
      : 1;
  const numeric = normalized
    .replace(/[^0-9.,]/g, "")
    .replaceAll(",", "");
  if (!numeric) return undefined;
  const amount = Number(numeric) * multiplier;
  return Number.isFinite(amount) ? amount : undefined;
};

const parseMoneyValue = (value: unknown): number | undefined =>
  Number.isFinite(value)
    ? (value as number)
    : parseDaftMoney(typeof value === "string" ? value : undefined);

const parsePropertySize = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const match = value.replaceAll(",", "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
};

const berValue = (rating: string | undefined): number | undefined => {
  if (!rating) return undefined;
  const normalized = rating.trim().toUpperCase();
  const candidate =
    normalized === "EXEMPT"
      ? "exempt"
      : normalized === "A0"
        ? "A0"
        : normalized[0];
  const index = DAFT_BER_RATINGS.indexOf(candidate as DaftBerRating);
  if (index < 0) return undefined;
  // Sold-search simplifiedBer values are one-based for graded BERs.
  return candidate === "exempt" ? 0 : index + 1;
};

const normalizedPropertyType = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ");

export const soldPropertyTypePath = (
  value: string | undefined,
): string | undefined => {
  if (!value) return undefined;
  const type = normalizedPropertyType(value);
  if (type.includes("studio")) return "studio-apartments";
  if (type.includes("duplex")) return "duplexes";
  if (type.includes("end of terrace")) return "end-of-terrace-houses";
  if (type.includes("semi")) return "semi-detached-houses";
  if (type.includes("detached")) return "detached-houses";
  if (type.includes("terrace")) return "terraced-houses";
  if (type.includes("townhouse")) return "townhouses";
  if (type.includes("bungalow")) return "bungalows";
  if (type.includes("apartment")) return "apartments";
  if (type.includes("site")) return "sites";
  if (type.includes("house")) return "houses";
  return undefined;
};
export const hasDaftSoldMatchFields = (
  finding: Pick<
    DaftFinding,
    | "berRating"
    | "bedrooms"
    | "bathrooms"
    | "floorSizeSqm"
    | "propertyType"
  >,
): boolean =>
  finding.bedrooms !== undefined &&
  finding.bathrooms !== undefined &&
  finding.floorSizeSqm !== undefined &&
  finding.berRating !== undefined &&
  soldPropertyTypePath(finding.propertyType) !== undefined;

const addOptional = (
  params: URLSearchParams,
  name: string,
  value: string | number | undefined,
): void => {
  if (value !== undefined) params.append(name, String(value));
};

const hasSpatialConstraint = (request: DaftSoldSearchRequest): boolean =>
  request.locations.length > 0 ||
  request.finding.eircode !== undefined ||
  request.finding.address !== undefined;

export const buildDaftSoldSearchUrl = (
  request: DaftSoldSearchRequest,
  page = 1,
): string | undefined => {
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`Daft sold page must be a positive integer: ${page}`);
  }
  if (request.locations.length > 1) {
    throw new Error(
      "Daft sold URLs must be built one location at a time",
    );
  }
  if (!hasSpatialConstraint(request)) return undefined;

  const base = new URL(request.baseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const propertyTypePath = soldPropertyTypePath(request.finding.propertyType);
  const pathParts = [
    basePath,
    "sold-properties",
    "ireland",
    propertyTypePath,
  ].filter(Boolean);
  base.pathname = pathParts.join("/").replace(/^([^/])/, "/$1");

  const params = new URLSearchParams();
  if (request.locations.length > 0) {
    for (const location of request.locations) params.append("location", location);
  } else if (request.finding.eircode !== undefined) {
    params.append("name", "eircode");
    params.append("filterType", "Eircode");
    params.append("searchQueryGroup", "geoFilter");
    params.append("geoSearchType", "POINT_AND_EIRCODE");
    params.append("eircode", request.finding.eircode);
    params.append("rad", "1000");
  } else {
    params.append("name", "eircode");
    params.append("filterType", "Eircode");
    params.append("searchQueryGroup", "geoFilter");
    params.append("geoSearchType", "POINT_AND_EIRCODE");
    params.append("address", request.finding.address!);
    params.append("rad", "1000");
  }

  addOptional(params, "numBeds_from", request.finding.bedrooms);
  addOptional(params, "soldDate_from", request.year);
  addOptional(params, "numBaths_from", request.finding.bathrooms);
  const simplifiedBer = berValue(request.finding.berRating);
  addOptional(params, "simplifiedBer_from", simplifiedBer);
  addOptional(params, "floorSize_from", request.finding.floorSizeSqm);
  if (page > 1) params.append("page", String(page));

  base.search = params.toString();
  return base.toString();
};

export const parseDaftSoldPage = (
  payload: unknown,
): DaftSoldPageResult => {
  const root = asRecord(payload);
  const props = asRecord(root?.props);
  const pageProps = asRecord(props?.pageProps) ?? root ?? {};
  const prices: number[] = [];
  if (Array.isArray(pageProps.listings)) {
    for (const value of pageProps.listings) {
      const listing = asRecord(asRecord(value)?.listing);
      const price = parseMoneyValue(
        listing?.soldPrice ?? listing?.price,
      );
      if (price !== undefined) prices.push(price);
    }
  }
  const paging = asRecord(pageProps.paging);
  const currentPage = numberValue(paging, "currentPage") ?? 1;
  const totalPages = numberValue(paging, "totalPages") ?? currentPage;
  return { prices, currentPage, totalPages };
};

export const summarizeDaftSoldPrices = (
  prices: readonly number[],
  year: number,
  askingPriceText: string | undefined,
): DaftSoldComparison => {
  const askingPriceEur = parseDaftMoney(askingPriceText);
  if (prices.length === 0) {
    return {
      year,
      comparableCount: 0,
      ...(askingPriceEur === undefined ? {} : { askingPriceEur }),
    };
  }
  const minPriceEur = Math.min(...prices);
  const maxPriceEur = Math.max(...prices);
  const verdict: DaftSoldVerdict =
    askingPriceEur === undefined
      ? "unavailable"
      : askingPriceEur > maxPriceEur
        ? "above"
        : askingPriceEur < minPriceEur
          ? "below"
          : "within";
  return {
    year,
    comparableCount: prices.length,
    minPriceEur,
    maxPriceEur,
    ...(askingPriceEur === undefined ? {} : { askingPriceEur }),
    verdict,
  };
};

export const parseListingFloorSize = (
  listing: JsonRecord | undefined,
): number | undefined => {
  const propertySize = listing?.propertySize;
  return (
    numberValue(asRecord(listing?.floorArea), "value") ??
    parsePropertySize(
      typeof propertySize === "string" ? propertySize : undefined,
    )
  );
};
