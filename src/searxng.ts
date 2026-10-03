import type { MonitorConfig } from "./config.js";
import type { DaftPropertyType } from "./daft/filters.js";
import type { DaftSectionPath } from "./daft/sections.js";
import type { DiscoveryCandidate } from "./listings.js";

export type SearxngQueryInputs = Pick<
  MonitorConfig["daft"],
  "sectionPath" | "locations" | "filters"
>;

export interface SearxngSearchOptions extends SearxngQueryInputs {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly now?: () => Date;
}

export type SearxngCandidate = DiscoveryCandidate;

export type SearxngErrorCode =
  | "invalid-base-url"
  | "request-failed"
  | "rate-limited"
  | "json-disabled"
  | "http-error"
  | "invalid-payload";

export interface SearxngSearchError {
  readonly code: SearxngErrorCode;
  readonly message: string;
  readonly status?: number;
}

export type SearxngSearchResult =
  | { readonly ok: true; readonly candidates: readonly SearxngCandidate[] }
  | { readonly ok: false; readonly error: SearxngSearchError };

const SECTION_QUERY: Record<DaftSectionPath, string> = {
  "new-homes-for-sale": "new homes for sale",
  "property-for-sale": "property for sale",
  "property-for-rent": "property for rent",
};

const PROPERTY_TYPE_QUERY: Record<DaftPropertyType, string> = {
  houses: "houses",
  "detached-houses": "detached houses",
  "semi-detached-houses": "semi-detached houses",
  "terraced-houses": "terraced houses",
  "end-of-terrace-houses": "end of terrace houses",
  townhouses: "townhouses",
  apartments: "apartments",
  "studio-apartments": "studio apartments",
  duplexes: "duplexes",
  bungalows: "bungalows",
  sites: "sites",
};

const quoted = (value: string): string => `"${value.replaceAll('"', '\\"')}"`;

const rangeQuery = (
  min: number | undefined,
  max: number | undefined,
  unit: string,
): string | undefined => {
  if (min !== undefined && max !== undefined) {
    return min === max ? `${min} ${unit}` : `${min} to ${max} ${unit}`;
  }
  if (min !== undefined) {return `${min}+ ${unit}`;}
  if (max !== undefined) {return `up to ${max} ${unit}`;}
  return undefined;
};

export const buildSearxngQuery = (inputs: SearxngQueryInputs): string => {
  const { filters } = inputs;
  const terms = [SECTION_QUERY[inputs.sectionPath]];
  const locations = inputs.locations.map((location) => location.trim()).filter(Boolean);

  if (locations.length === 1) {
    const location = locations[0];
    if (location !== undefined) { terms.push(quoted(location)); }
  } else if (locations.length > 1) {
    terms.push(`(${locations.map(quoted).join(" OR ")})`);
  }

  const keyword = filters.keyword?.trim();
  if (keyword) {terms.push(keyword);}

  if (filters.propertyTypes.length > 0) {
    terms.push(
      `(${filters.propertyTypes.map((type) => PROPERTY_TYPE_QUERY[type]).join(" OR ")})`,
    );
  }

  const bedrooms = rangeQuery(filters.bedsMin, filters.bedsMax, "bedrooms");
  if (bedrooms) {terms.push(bedrooms);}

  const bathrooms = rangeQuery(filters.bathsMin, filters.bathsMax, "bathrooms");
  if (bathrooms) {terms.push(bathrooms);}

  return terms.join(" ");
};

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
};

const parseCandidates = (
  payload: unknown,
  discoveredAt: string,
): readonly SearxngCandidate[] | undefined => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    !("results" in payload) ||
    !Array.isArray(payload.results)
  ) {return undefined;}
  const results = payload.results as unknown[];


  const candidates: SearxngCandidate[] = [];
  for (const result of results) {
    if (
      typeof result !== "object" ||
      result === null ||
      Array.isArray(result)
    ) {return undefined;}
    if (!("title" in result) || typeof result.title !== "string" || result.title.trim() === "") {return undefined;}
    if (!("url" in result) || typeof result.url !== "string" || !isHttpUrl(result.url)) {return undefined;}
    if ("content" in result && result.content !== undefined && typeof result.content !== "string") {return undefined;}
    if ("engine" in result && result.engine !== undefined && typeof result.engine !== "string") {return undefined;}
    if (!("content" in result) || typeof result.content !== "string") {continue;}
    const engine = "engine" in result && typeof result.engine === "string"
      ? result.engine
      : undefined;
    candidates.push({
      title: result.title,
      url: result.url,
      snippet: result.content,
      ...(engine === undefined ? {} : { engine }),
      source: "searxng",
      discoveredAt,
      verified: false,
    });
  }
  return candidates;
};

const error = (
  code: SearxngErrorCode,
  message: string,
  status?: number,
): SearxngSearchResult => ({
  ok: false,
  error: {
    code,
    message,
    ...(status === undefined ? {} : { status }),
  },
});

export const searchSearxng = async (
  options: SearxngSearchOptions,
): Promise<SearxngSearchResult> => {
  let base: URL;
  try {
    base = new URL(options.baseUrl);
  } catch {
    return error("invalid-base-url", "SearXNG base URL must be an absolute HTTP(S) URL");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return error("invalid-base-url", "SearXNG base URL must be an absolute HTTP(S) URL");
  }

  const url = new URL(base);
  url.pathname = `${base.pathname.replace(/\/+$/, "")}/search`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("q", buildSearxngQuery(options));
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "en-IE");

  let response: Response;
  try {
    response = await options.fetch(url, { method: "GET", headers: { accept: "application/json" } });
  } catch {
    return error("request-failed", "SearXNG request failed");
  }

  if (response.status === 429) {
    return error("rate-limited", "SearXNG rate limit reached", response.status);
  }
  if (response.status === 403) {
    return error("json-disabled", "SearXNG JSON search is disabled", response.status);
  }
  if (!response.ok) {
    return error("http-error", "SearXNG returned an unsuccessful HTTP status", response.status);
  }

  const contentType = response.headers.get("content-type");
  if (contentType !== null && !/^application\/(?:[\w.+-]*\+)?json(?:\s*;|\s*$)/i.test(contentType)) {
    return error("json-disabled", "SearXNG did not return JSON; JSON search may be disabled");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return error("invalid-payload", "SearXNG returned malformed JSON");
  }

  const discoveredAt = (options.now ?? (() => new Date()))().toISOString();
  const candidates = parseCandidates(payload, discoveredAt);
  if (candidates === undefined) {
    return error("invalid-payload", "SearXNG returned an invalid results payload");
  }
  return { ok: true, candidates };
};
