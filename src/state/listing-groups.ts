import { sourcedListingKey, type SourcedListing } from "../listings.js";

interface ListingGroupingEvidence {
  readonly addressGroupKey?: string;
  readonly bedrooms: number;
  readonly eircode?: string;
  readonly eircodeGroupKey?: string;
  readonly propertyType: string;
}

interface GroupingIndexEntry {
  readonly canonicalGroupKey: string | null;
  readonly evidence: ListingGroupingEvidence | undefined;
}

interface GroupingReassignment {
  readonly bellwatchKey: string;
  readonly canonicalGroupKey: string | undefined;
}

export interface ListingGroupingPlan {
  readonly bellwatchKey: string;
  readonly evidence: ListingGroupingEvidence | undefined;
  readonly canonicalGroupKey: string | undefined;
  readonly relatedReassignments: readonly GroupingReassignment[];
  readonly seenGroupTransfers: readonly {
    readonly from: string;
    readonly to: string;
  }[];
}

export interface ListingGrouping {
  readonly restore: (
    bellwatchKey: string,
    listing: SourcedListing,
    canonicalGroupKey: string | null,
  ) => void;
  readonly planFor: (listing: SourcedListing) => ListingGroupingPlan;
  readonly apply: (plan: ListingGroupingPlan) => void;
}

const normalizeGroupingText = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s,._-]+/g, " ");

const groupingEvidenceFor = (
  listing: SourcedListing,
): ListingGroupingEvidence | undefined => {
  const { facts } = listing;
  const eircode = facts.eircode?.trim().replace(/\s+/g, "").toUpperCase();
  const address = facts.address === undefined
    ? undefined
    : normalizeGroupingText(facts.address);
  const propertyType = facts.propertyType === undefined
    ? undefined
    : normalizeGroupingText(facts.propertyType);
  const bedrooms = facts.bedrooms;

  if (
    propertyType === undefined ||
    propertyType.length === 0 ||
    bedrooms === undefined ||
    !Number.isFinite(bedrooms) ||
    bedrooms <= 0
  ) {
    return undefined;
  }

  const normalizedEircode = eircode === "" ? undefined : eircode;
  const addressGroupKey = address
    ? JSON.stringify([`address:${address}`, propertyType, bedrooms])
    : undefined;
  if (addressGroupKey === undefined && normalizedEircode === undefined) {
    return undefined;
  }
  return {
    ...(addressGroupKey === undefined ? {} : { addressGroupKey }),
    bedrooms,
    ...(normalizedEircode === undefined ? {} : { eircode: normalizedEircode }),
    ...(normalizedEircode === undefined
      ? {}
      : {
          eircodeGroupKey: JSON.stringify([
            `eircode:${normalizedEircode}`,
            propertyType,
            bedrooms,
          ]),
        }),
    propertyType,
  };
};

export const createListingGrouping = (): ListingGrouping => {
  const byAddressGroup = new Map<string, Set<string>>();
  const byListingKey = new Map<string, GroupingIndexEntry>();

  const setEntry = (
    bellwatchKey: string,
    entry: GroupingIndexEntry,
  ): void => {
    const previous = byListingKey.get(bellwatchKey);
    const previousAddressGroup = previous?.evidence?.addressGroupKey;
    if (previousAddressGroup !== undefined) {
      const previousKeys = byAddressGroup.get(previousAddressGroup);
      previousKeys?.delete(bellwatchKey);
      if (previousKeys?.size === 0) {
        byAddressGroup.delete(previousAddressGroup);
      }
    }

    byListingKey.set(bellwatchKey, entry);
    const addressGroup = entry.evidence?.addressGroupKey;
    if (addressGroup !== undefined) {
      let keys = byAddressGroup.get(addressGroup);
      if (keys === undefined) {
        keys = new Set();
        byAddressGroup.set(addressGroup, keys);
      }
      keys.add(bellwatchKey);
    }
  };

  const planFor = (
    bellwatchKey: string,
    evidence: ListingGroupingEvidence | undefined,
  ): ListingGroupingPlan => {
    if (evidence === undefined) {
      return {
        bellwatchKey,
        evidence,
        canonicalGroupKey: undefined,
        relatedReassignments: [],
        seenGroupTransfers: [],
      };
    }

    const previous = byListingKey.get(bellwatchKey);
    const relatedKeys = evidence.addressGroupKey === undefined
      ? undefined
      : byAddressGroup.get(evidence.addressGroupKey);
    const eircodes = new Set<string>();
    for (const relatedKey of relatedKeys ?? []) {
      if (relatedKey === bellwatchKey) {
        continue;
      }
      const related = byListingKey.get(relatedKey)?.evidence;
      if (related?.eircode !== undefined) {
        eircodes.add(related.eircode);
      }
    }
    if (evidence.eircode !== undefined) {
      eircodes.add(evidence.eircode);
    }

    let fallbackGroupKey = evidence.addressGroupKey;
    if (eircodes.size === 1) {
      const [eircode] = eircodes;
      if (eircode !== undefined) {
        fallbackGroupKey = JSON.stringify([
          `eircode:${eircode}`,
          evidence.propertyType,
          evidence.bedrooms,
        ]);
      }
    } else if (eircodes.size > 1) {
      fallbackGroupKey = undefined;
    }
    const canonicalGroupKey = evidence.eircodeGroupKey ?? fallbackGroupKey;
    const relatedReassignments: GroupingReassignment[] = [];
    const seenGroupTransfers: { from: string; to: string }[] = [];
    for (const relatedKey of relatedKeys ?? []) {
      if (relatedKey === bellwatchKey) {
        continue;
      }
      const entry = byListingKey.get(relatedKey);
      if (entry?.evidence?.eircode !== undefined) {
        continue;
      }
      const targetGroupKey = fallbackGroupKey ?? undefined;
      if (entry === undefined || entry.canonicalGroupKey === (targetGroupKey ?? null)) {
        continue;
      }
      relatedReassignments.push({
        bellwatchKey: relatedKey,
        canonicalGroupKey: targetGroupKey,
      });
      if (targetGroupKey !== undefined && entry.canonicalGroupKey !== null) {
        seenGroupTransfers.push({ from: entry.canonicalGroupKey, to: targetGroupKey });
      }
    }
    if (
      previous?.evidence?.addressGroupKey !== undefined &&
      previous.evidence.eircode === undefined &&
      previous.canonicalGroupKey !== null &&
      previous.canonicalGroupKey !== canonicalGroupKey &&
      canonicalGroupKey !== undefined &&
      fallbackGroupKey !== undefined
    ) {
      seenGroupTransfers.push({
        from: previous.canonicalGroupKey,
        to: canonicalGroupKey,
      });
    }
    return {
      bellwatchKey,
      evidence,
      canonicalGroupKey,
      relatedReassignments,
      seenGroupTransfers,
    };
  };

  return {
    restore: (bellwatchKey, listing, canonicalGroupKey) => {
      setEntry(bellwatchKey, {
        evidence: groupingEvidenceFor(listing),
        canonicalGroupKey,
      });
    },
    planFor: (listing) =>
      planFor(sourcedListingKey(listing), groupingEvidenceFor(listing)),
    apply: (plan) => {
      for (const reassign of plan.relatedReassignments) {
        const previous = byListingKey.get(reassign.bellwatchKey);
        if (previous !== undefined) {
          setEntry(reassign.bellwatchKey, {
            evidence: previous.evidence,
            canonicalGroupKey: reassign.canonicalGroupKey ?? null,
          });
        }
      }
      setEntry(plan.bellwatchKey, {
        evidence: plan.evidence,
        canonicalGroupKey: plan.canonicalGroupKey ?? null,
      });
    },
  };
};
