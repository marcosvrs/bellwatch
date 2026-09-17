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

test("recognizes SHPS aliases and punctuation-normalized evidence", () => {
  const cases = [
    "LAAPS. The local authority retains an equity share.",
    "Starter-Homes Programme. The local authority retains an equity share.",
    "Affordable dwelling purchase arrangement. The local authority retains an equity share.",
  ];
  for (const schemeText of cases) {
    assert.equal(
      classifyShpsAvailability(makeFinding("alias", { schemeText })),
      "shps-only",
    );
  }
  assert.equal(
    classifyShpsAvailability(
      makeFinding("boundary", {
        title: "SHPSX",
        schemeText: "Private new homes.",
      }),
    ),
    "not-shps",
  );
  assert.equal(
    classifyShpsAvailability(
      makeFinding("multi-punctuation", {
        schemeText:
          "Starter---Home Purchase Scheme. The local authority retains an equity share.",
      }),
    ),
    "shps-only",
  );
});

test("requires complete optional Help to Buy funding language", () => {
  assert.equal(
    classifyShpsAvailability(
      makeFinding("optional-missing-funding", {
        schemeText:
          "Starter Home Purchase Scheme. Help to Buy, if eligible.",
      }),
    ),
    "shps-and-other",
  );
  assert.equal(
    classifyShpsAvailability(
      makeFinding("optional-missing-eligibility", {
        schemeText:
          "Starter Home Purchase Scheme. Help to Buy mortgage funding.",
      }),
    ),
    "shps-and-other",
  );
  assert.equal(
    classifyShpsAvailability(
      makeFinding("optional-complete", {
        schemeText:
          "Starter Home Purchase Scheme. Help to Buy mortgage funding where eligible.",
      }),
    ),
    "shps-only",
  );
  assert.equal(
    classifyShpsAvailability(
      makeFinding("optional-then-explicit", {
        schemeText:
          "Starter Home Purchase Scheme. Help to Buy mortgage funding where eligible. Help to Buy is available.",
      }),
    ),
    "shps-and-other",
  );
  assert.equal(
    classifyShpsAvailability(
      makeFinding("affordable-purchase-scheme", {
        schemeText:
          "Local Authority Affordable Purchase scheme. The local authority retains an equity share.",
      }),
    ),
    "shps-only",
  );
});

test("rejects every named additional and unrecognised scheme form", () => {
  for (const schemeText of [
    "Starter Home Purchase Scheme. First Home Scheme.",
    "Starter Home Purchase Scheme. Cost Rental.",
    "Starter Home Purchase Scheme. Help to Buy is available.",
    "Starter Home Purchase Scheme. This is an affordable green homes scheme.",
  ]) {
    assert.equal(
      classifyShpsAvailability(makeFinding("other", { schemeText })),
      "shps-and-other",
      schemeText,
    );
  }
  assert.equal(
    classifyShpsAvailability(
      makeFinding("priority", {
        schemeText: "Starter Home Purchase Scheme. This is a scheme of priority.",
      }),
    ),
    "shps-only",
  );
  assert.equal(
    classifyShpsAvailability(
      makeFinding("generic", {
        schemeText: "Starter Home Purchase Scheme. This is the scheme.",
      }),
    ),
    "shps-only",
  );
  assert.equal(
    classifyShpsAvailability(
      makeFinding("generic-plural", {
        schemeText: "Starter Home Purchase Scheme. These are other schemes.",
      }),
    ),
    "shps-and-other",
  );
});

test("handles alias boundaries, HTB aliases, and blank evidence", () => {
  assert.equal(
    classifyShpsAvailability(
      makeFinding("alias", {
        title: "SHPS",
        developmentTitle: "Development",
        schemeText: "HTB mortgage funding where eligible.",
      }),
    ),
    "shps-only",
  );
  assert.equal(
    classifyShpsAvailability(
      makeFinding("blank-evidence", {
        title: "SHPS",
        schemeText: "   ",
      }),
    ),
    "unknown",
  );
});

test("distinguishes recognized aliases from concatenated scheme prose", () => {
  assert.equal(
    classifyShpsAvailability(
      makeFinding("alias-at-end", {
        title: "Private development",
        developmentTitle: "Development",
        schemeText: "SHPS",
      }),
    ),
    "shps-only",
  );
  assert.equal(
    classifyShpsAvailability(
      makeFinding("separated-prose", {
        schemeText: "Starter Home Purchase Scheme other scheme.",
      }),
    ),
    "shps-and-other",
  );
});
