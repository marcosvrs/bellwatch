import type { DaftFilters } from "./filters.js";
import { addedInLastDateValue } from "./filters.js";

export interface DaftSearchRequest {
  readonly baseUrl: string;
  readonly sectionPath: string;
  readonly locationPath: string;
  readonly filters: DaftFilters;
}

const encodePath = (value: string): string =>
  value
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");

const addOptional = (params: URLSearchParams, name: string, value: unknown) => {
  if (value !== undefined && value !== "") params.append(name, String(value));
};

export const buildDaftSearchUrl = (
  request: DaftSearchRequest,
  page = 1,
): string => {
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`Daft page must be a positive integer: ${page}`);
  }

  const base = new URL(request.baseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const sectionPath = encodePath(request.sectionPath);
  const locationPath = encodePath(request.locationPath);
  const propertyTypes = [...request.filters.propertyTypes];
  const singlePropertyType = propertyTypes.length === 1 ? propertyTypes[0] : undefined;
  const pathParts = [basePath, sectionPath, locationPath];
  if (singlePropertyType) pathParts.push(singlePropertyType);
  base.pathname = pathParts.filter(Boolean).join("/").replace(/^([^/])/, "/$1");
  base.search = "";

  const params = new URLSearchParams();
  if (request.filters.radiusKm > 0) {
    params.append("radius", String(request.filters.radiusKm * 1000));
  }
  addOptional(params, "salePrice_from", request.filters.priceMinEur);
  addOptional(params, "salePrice_to", request.filters.priceMaxEur);
  addOptional(params, "numBeds_from", request.filters.bedsMin);
  addOptional(params, "numBeds_to", request.filters.bedsMax);
  addOptional(params, "numBaths_from", request.filters.bathsMin);
  addOptional(params, "numBaths_to", request.filters.bathsMax);
  if (!singlePropertyType) {
    for (const propertyType of propertyTypes) {
      params.append("propertyType", propertyType);
    }
  }
  for (const mediaType of request.filters.mediaTypes) {
    params.append("mediaTypes", mediaType);
  }
  addOptional(params, "terms", request.filters.keyword);
  if (request.filters.availability !== "published") {
    params.append("adState", request.filters.availability);
  }
  addOptional(
    params,
    "firstPublishDate_from",
    addedInLastDateValue(request.filters.addedInLastDays),
  );
  addOptional(params, "viewingTimes_from", request.filters.openViewingsFrom);
  params.append("sort", request.filters.sort);
  if (page > 1) params.append("page", String(page));

  base.search = params.toString();
  return base.toString();
};

export const buildDaftSearchUrls = (
  request: DaftSearchRequest,
  maxPages: number,
): string[] => {
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error(`Daft max pages must be a positive integer: ${maxPages}`);
  }
  return Array.from({ length: maxPages }, (_, index) =>
    buildDaftSearchUrl(request, index + 1),
  );
};
