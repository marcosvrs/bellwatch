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