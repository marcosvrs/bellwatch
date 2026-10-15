import type { DaftSoldComparison } from "./daft/sold.js";
import type { MyHomeEvidence } from "./myhome.js";

export type ListingSource = "daft" | "myhome";

export interface ListingFacts {
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
  readonly url: string;
  readonly schemeText?: string;
}

export interface DaftListingEvidence {
  readonly soldComparison?: DaftSoldComparison;
  readonly individualUnit?: boolean;
}

export interface SourcedListingFields {
  readonly sourceId: string;
  readonly facts: ListingFacts;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly dublinBoundary?: DublinListingBoundary;
}

export type SourcedListing =
  | (SourcedListingFields & {
      readonly source: "daft";
      readonly daftEvidence?: DaftListingEvidence;
    })
  | (SourcedListingFields & {
      readonly source: "myhome";
      readonly myhomeEvidence?: MyHomeEvidence;
    });

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

export const sourcedListingKey = (
  listing: Pick<SourcedListing, "source" | "sourceId">,
): string => `${listing.source}:${listing.sourceId}`;