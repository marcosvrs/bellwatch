import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyShpsAvailability,
  filterShpsFindings,
  isShpsOnlyFinding,
  type ShpsConfig,
} from "../src/daft/shps.js";
import type { DaftFinding } from "../src/daft/parser.js";

const makeFinding = (
  id: string,
  overrides: Partial<DaftFinding> = {},
): DaftFinding => ({
  id,
  title: `Development ${id}`,
  developmentTitle: `Development ${id}`,
  priceText: "€315,000",
  url: `https://www.daft.ie/new-home-for-sale/example/${id}`,
  ...overrides,
});

const filter = (
  findings: readonly DaftFinding[],
  config: ShpsConfig,
): readonly DaftFinding[] => filterShpsFindings(findings, config);

const shpsOnlyDescription =
  "This home is offered under the Starter Home Purchase Scheme. " +
  "The local authority retains an equity share.";

test("requires full listing evidence for an SHPS-only match", () => {
  const finding = makeFinding("101", {
    title: "Starter Home Purchase Scheme",
    schemeText: shpsOnlyDescription,
  });
  assert.equal(classifyShpsAvailability(finding), "shps-only");
  assert.equal(isShpsOnlyFinding(finding), true);
  assert.equal(
    classifyShpsAvailability(
      makeFinding("102", { title: "Starter Home Purchase Scheme" }),
    ),
    "unknown",
  );
  assert.equal(
    classifyShpsAvailability(makeFinding("103", { schemeText: "Private new homes." })),
    "not-shps",
  );
});

test("rejects explicit co-availability with Help to Buy", () => {
  const finding = makeFinding("201", {
    schemeText:
      "This home is available under both the Help to Buy scheme and the " +
      "Starter Home Purchase Scheme.",
  });
  assert.equal(classifyShpsAvailability(finding), "shps-and-other");
  assert.equal(isShpsOnlyFinding(finding), false);
});

test("allows SHPS funding text that only makes Help to Buy optional", () => {
  const finding = makeFinding("202", {
    schemeText:
      "Starter Home Purchase Scheme. The minimum sale price must be met " +
      "through mortgage, savings, and (if eligible) the Help to Buy scheme.",
  });
  assert.equal(classifyShpsAvailability(finding), "shps-only");
});

test("rejects a named but unsupported additional scheme", () => {
  const finding = makeFinding("203", {
    schemeText:
      "Starter Home Purchase Scheme. This home is also available through " +
      "the Local Authority Home Loan Scheme.",
  });
  assert.equal(classifyShpsAvailability(finding), "shps-and-other");
});

test("only mode keeps proven SHPS-only findings and fails closed", () => {
  const findings = [
    makeFinding("301", { schemeText: shpsOnlyDescription }),
    makeFinding("302", {
      schemeText:
        "Starter Home Purchase Scheme and Help to Buy are both available.",
    }),
    makeFinding("303", { title: "Starter Home Purchase Scheme" }),
    makeFinding("304", { schemeText: "Private new homes." }),
  ];

  assert.deepEqual(
    filter(findings, { filter: "only" }).map((finding) => finding.id),
    ["301"],
  );
});

test("exclude mode removes only proven SHPS-only findings", () => {
  const findings = [
    makeFinding("305", { schemeText: shpsOnlyDescription }),
    makeFinding("306", {
      schemeText:
        "Starter Home Purchase Scheme and Help to Buy are both available.",
    }),
    makeFinding("307", { title: "Private new homes." }),
    makeFinding("308", { title: "Starter Home Purchase Scheme" }),
  ];

  assert.deepEqual(
    filter(findings, { filter: "exclude" }).map((finding) => finding.id),
    ["306", "307", "308"],
  );
});

test("off mode preserves all findings", () => {
  const findings = [makeFinding("401"), makeFinding("402")];
  assert.deepEqual(filter(findings, { filter: "off" }), findings);
});
