import type { DaftFinding } from "./daft/parser.js";

export type ListingSource = "daft" | "myhome";

export interface SourcedFinding {
  readonly source: ListingSource;
  readonly sourceId: string;
  readonly finding: DaftFinding;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly dublinBoundary?: DublinListingBoundary;
}

export type DublinListingBoundary =
  | {
      readonly status: "classified";
      readonly insideCounty: boolean;
      readonly nearestBoundaryDistanceKm: number;
      readonly withinDublin20Km: boolean;
    }
  | {
      readonly status: "unclassified";
      readonly reason: "missing-coordinates" | "boundary-unavailable" | "invalid-coordinates";
    };

const HOUSE_TYPE =
  /\b(?:houses?|bungalows?|town ?houses?|detached|semi|terraced?|end of terrace|cottage)\b/;
const NON_HOUSE_TYPE =
  /\b(?:apartment|flat|duplex|studio|maisonette|penthouse)\b/;

export const isQualifyingHouse = (finding: DaftFinding): boolean => {
  if (
    finding.individualUnit === false ||
    finding.bedrooms === undefined ||
    finding.bedrooms < 3 ||
    finding.propertyType === undefined
  ) {
    return false;
  }
  const propertyType = finding.propertyType
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return !NON_HOUSE_TYPE.test(propertyType) && HOUSE_TYPE.test(propertyType);
};

export interface DiscoveryCandidate {
  readonly source: "searxng";
  readonly verified: false;
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly engine?: string;
  readonly discoveredAt: string;
}

export const sourcedFindingKey = (
  listing: Pick<SourcedFinding, "source" | "sourceId">,
): string => `${listing.source}:${listing.sourceId}`;