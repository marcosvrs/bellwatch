import assert from "node:assert/strict";
import test from "node:test";
import type { DaftFinding } from "../src/daft/parser.js";
import { isQualifyingHouse } from "../src/listings.js";

const finding = (
  overrides: Omit<Partial<DaftFinding>, "propertyType" | "bedrooms"> & {
    readonly propertyType?: string | undefined;
    readonly bedrooms?: number | undefined;
  } = {},
): DaftFinding => {
  const { bedrooms, propertyType, ...rest } = overrides;
  return {
    id: "listing-1",
    title: "Example home",
    developmentTitle: "Mixed development",
    priceText: "POA",
    ...(
      Object.hasOwn(overrides, "bedrooms")
        ? bedrooms === undefined ? {} : { bedrooms }
        : { bedrooms: 3 }
    ),
    ...(
      Object.hasOwn(overrides, "propertyType")
        ? propertyType === undefined ? {} : { propertyType }
        : { propertyType: "Semi-detached house" }
    ),
    url: "https://example.test/listing-1",
    ...rest,
  };
};

test("qualifies individual three-plus bedroom houses, not mixed-development apartments", () => {
  assert.equal(isQualifyingHouse(finding()), true);
  assert.equal(isQualifyingHouse(finding({ bedrooms: 4 })), true);
  assert.equal(
    isQualifyingHouse(
      finding({ title: "3 bed house", developmentTitle: "Apartments and houses" }),
    ),
    true,
  );
  assert.equal(isQualifyingHouse(finding({ bedrooms: 2 })), false);
  assert.equal(isQualifyingHouse(finding({ propertyType: "Duplex" })), false);
  assert.equal(isQualifyingHouse(finding({ propertyType: "Residential" })), false);
  assert.equal(isQualifyingHouse(finding({ propertyType: "Apartment" })), false);
  assert.equal(isQualifyingHouse(finding({ propertyType: undefined })), false);
  assert.equal(isQualifyingHouse(finding({ bedrooms: undefined })), false);
  assert.equal(isQualifyingHouse(finding({ individualUnit: false })), false);
});
