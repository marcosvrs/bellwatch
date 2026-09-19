import type { DaftFilters } from "./filters.js";
import { addedInLastDateValue } from "./filters.js";
import {
  DEFAULT_DAFT_SECTION,
  daftSectionForPath,
} from "./sections.js";

interface DaftSearchRequest {
  readonly baseUrl: string;
  readonly sectionPath: string;
  readonly locations: readonly string[];
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
  if (request.locations.length > 1) {
    throw new Error(
      "Daft search URLs must be built one location at a time",
    );
  }

  const section =
    daftSectionForPath(request.sectionPath) ?? DEFAULT_DAFT_SECTION;
  const base = new URL(request.baseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const sectionPath = encodePath(request.sectionPath);
  const propertyTypes = [...request.filters.propertyTypes];
  const singlePropertyType =
    propertyTypes.length === 1 ? propertyTypes[0] : undefined;
  const hasSingleLocation = request.locations.length === 1;
  const locationPath = hasSingleLocation
    ? encodeURIComponent(request.locations[0]!)
    : "ireland";
  const pathParts = [
    basePath,
    sectionPath,
    locationPath,
    singlePropertyType,
  ].filter(Boolean);
  base.pathname = pathParts.join("/").replace(/^([^/])/, "/$1");

  const params = new URLSearchParams();
  if (hasSingleLocation && request.filters.radiusKm) {
    params.append(
      "radius",
      String(request.filters.radiusKm * 1000),
    );
  }
  addOptional(
    params,
    `${section.priceParameter}_from`,
    request.filters.priceMinEur,
  );
  addOptional(
    params,
    `${section.priceParameter}_to`,
    request.filters.priceMaxEur,
  );
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
  section.encodeFilters(params, request.filters);
  addOptional(params, "sort", request.filters.sort);
  if (page > 1) params.append("page", String(page));

  base.search = params.toString();
  return base.toString();
};
