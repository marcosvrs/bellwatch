import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import { parseEnvironment } from "../src/config.js";
import { classifyHelpToBuyEvidence } from "../src/daft/shps.js";
import { MonitorError, runOnce, writeHeartbeat } from "../src/monitor.js";
import { sourcedFindingKey, type DiscoveryCandidate } from "../src/listings.js";
import type { DaftFinding } from "../src/daft/parser.js";
import type { CurrentListingRecord, StateStore } from "../src/state.js";
import type { DublinBoundaryGeometry } from "../src/dublin-boundary.js";

const defined = <T>(value: T | undefined): T => {
  if (value === undefined) {
    throw new Error("Expected value to be defined");
  }
  return value;
};

const makeFinding = (
  id: string,
  overrides: Partial<DaftFinding> = {},
): DaftFinding => ({
  id,
  title: `Development ${id}`,
  developmentTitle: `Development ${id}`,
  priceText: "€315,000",
  bedrooms: 3,
  propertyType: "House",
  url: `https://www.daft.ie/new-home-for-sale/example/${id}`,
  ...overrides,
});

const makeState = (previouslySeen: readonly string[] = []): StateStore => {
  const seen = new Set(previouslySeen);
  const seenGroups = new Set<string>();
  const listings = new Map<string, CurrentListingRecord>();
  let initialized = false;
  return {
    isInitialized: () => Effect.succeed(initialized),
    markInitialized: () =>
      Effect.sync(() => {
        initialized = true;
      }),
    isSeen: (id, groupKey) =>
      Effect.succeed(seen.has(id) || (groupKey !== undefined && seenGroups.has(groupKey))),
    markSeen: (finding, groupKey) =>
      Effect.sync(() => {
        seen.add(finding.id);
        if (groupKey !== undefined) { seenGroups.add(groupKey); }
      }),
    observeFinding: (listing) =>
      Effect.sync(() => {
        const key = sourcedFindingKey(listing);
        const existing = listings.get(key);
        const now = new Date().toISOString();
        const eircode = listing.finding.eircode
          ?.trim()
          .replace(/\s+/g, "")
          .toUpperCase();
        const propertyType =
          listing.finding.propertyType?.trim().toLowerCase().replace(/[\s,._-]+/g, " ");
        const { bedrooms } = listing.finding;
        const canonicalGroupKey =
          eircode !== undefined &&
          propertyType !== undefined &&
          bedrooms !== undefined
            ? JSON.stringify([`eircode:${eircode}`, propertyType, bedrooms])
            : undefined;
        listings.set(key, {
          ...listing,
          bellwatchKey: key,
          firstSeenAt: existing?.firstSeenAt ?? now,
          lastSeenAt: now,
          ...(canonicalGroupKey === undefined ? {} : { canonicalGroupKey }),
        });
      }),
    getCurrentListing: (key) => Effect.succeed(listings.get(key)),
    listCurrentListings: () => Effect.succeed([...listings.values()]),
    listListingObservations: () => Effect.succeed([]),
    listPendingBaserowListings: () => Effect.succeed([]),
    markBaserowListingSynced: () => Effect.void,
    recordCandidate: () => Effect.void,
    listCurrentCandidates: () => Effect.succeed([]),
    listCandidateObservations: () => Effect.succeed([]),
    listPendingBaserowCandidates: () => Effect.succeed([]),
    markBaserowCandidateSynced: () => Effect.void,
    recordRegistrationEvent: () => Effect.void,
    listRegistrationEvents: () => Effect.succeed([]),
    close: () => Effect.void,
  };
};


const payload = (findings: readonly DaftFinding[]) => ({
  props: {
    pageProps: {
      listings: findings.map((finding) => ({
        listing: {
          id: Number(finding.id),
          title: finding.title,
          price: finding.priceText,
          seoFriendlyPath: `/new-home-for-sale/example/${finding.id}`,
          newHome: {
            subUnits: [
              {
                id: finding.id,
                price: finding.priceText,
                numBedrooms: `${finding.bedrooms ?? 3} Bed`,
                ...(finding.bathrooms === undefined
                  ? {}
                  : { numBathrooms: `${finding.bathrooms} Bath` }),
                propertyType: finding.propertyType ?? "House",
                seoFriendlyPath: `/new-home-for-sale/example/${finding.id}`,
                ...(finding.floorSizeSqm === undefined
                  ? {}
                  : {
                      floorArea: {
                        value: finding.floorSizeSqm,
                        unit: "METRES_SQUARED",
                      },
                    }),
                ...(finding.address === undefined && finding.eircode === undefined
                  ? {}
                  : {
                      addressDetails: {
                        ...(finding.address === undefined
                          ? {}
                          : { streetAddress: finding.address }),
                        ...(finding.eircode === undefined
                          ? {}
                          : { postalCode: finding.eircode }),
                      },
                    }),
              },
            ],
          },
        },
      })),
      paging: { currentPage: 1, totalPages: 1 },
    },
  },
});

const detailPayload = (schemeText: string) => ({
  props: {
    pageProps: {
      listing: {
        description: schemeText,
      },
    },
  },
});

const emptyDetailPayload = () => ({
  props: {
    pageProps: {
      listing: {},
    },
  },
});

const config = parseEnvironment({
  SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
  DAFT_MAX_PAGES: "1",
  NOTIFY_EXISTING_ON_FIRST_RUN: "false",
});
test("uses the configured rental section URL and parser", async () => {
  const rentalConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_SECTION_PATH: "property-for-rent",
    DAFT_LOCATION: "dublin",
    DAFT_PRICE_MAX_EUR: "2500",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const requested: string[] = [];
  const sent: string[] = [];
  const published: DaftFinding[] = [];
  const rentalPayload = {
    props: {
      pageProps: {
        listings: [
          {
            listing: {
              id: 700,
              title: "Riverside Apartments",
              prs: {
                subUnits: [
                  {
                    id: 701,
                    price: "€2,300 per month",
                    numBedrooms: "3 Bed",
                    numBathrooms: "2 Bath",
                    propertyType: "Semi-Detached House",
                  },
                ],
              },
            },
          },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  const result = await Effect.runPromise(
    runOnce(rentalConfig, {
      fetchPage: (url) =>
        Effect.sync(() => {
          requested.push(url);
          return rentalPayload;
        }),
      publish: (finding) =>
        Effect.sync(() => {
          published.push(finding);
          sent.push(finding.id);
        }),
      publishError: () => Effect.void,
      state: makeState(),
      heartbeat: () => Effect.void,
    }),
  );

  assert.equal(result.notified, 1);
  assert.deepEqual(sent, ["701"]);
  assert.equal(new URL(defined(requested[0])).pathname, "/property-for-rent/dublin");
  assert.equal(requested.length, 1);
  assert.equal(new URL(defined(requested[0])).searchParams.get("rentalPrice_to"), "2500");
  assert.equal(
    requested.some((url) => url.includes("/sold-properties/")),
    false,
  );
  assert.equal(Object.hasOwn(defined(published[0]), "soldComparison"), false);
});

test("enriches sale findings with current-year sold comparables", async () => {
  const saleConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_SECTION_PATH: "property-for-sale",
    DAFT_LOCATION: "dublin",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const requested: string[] = [];
  const published: DaftFinding[] = [];
  const salePayload = {
    props: {
      pageProps: {
        listings: [
          {
            listing: {
              id: 710,
              title: "Comparable Sale",
              price: "€500,000",
              numBedrooms: "3 Bed",
              numBathrooms: "2 Bath",
              propertyType: "Semi-D",
              floorArea: { value: "105", unit: "METRES_SQUARED" },
              ber: { rating: "B2" },
              seoFriendlyPath: "/for-sale/comparable-sale/710",
            },
          },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  const soldPayload = {
    props: {
      pageProps: {
        listings: [
          { listing: { soldPrice: "€400,000" } },
          { listing: { soldPrice: "€450,000" } },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };

  const result = await Effect.runPromise(
    runOnce(saleConfig, {
      fetchPage: (url) =>
        Effect.sync(() => {
          requested.push(url);
          return url.includes("/sold-properties/") ? soldPayload : salePayload;
        }),
      publish: (finding) =>
        Effect.sync(() => {
          published.push(finding);
        }),
      publishError: () => Effect.void,
      state: makeState(),
      heartbeat: () => Effect.void,
    }),
  );

  assert.equal(result.notified, 1);
  assert.equal(requested.length, 2);
  assert.equal(new URL(defined(requested[1])).pathname, "/sold-properties/ireland/semi-detached-houses");
  assert.deepEqual(defined(published[0]).soldComparison, {
    year: new Date().getFullYear(),
    comparableCount: 2,
    minPriceEur: 400000,
    maxPriceEur: 450000,
    askingPriceEur: 500000,
    verdict: "above",
  });
});
test("merges sold comparables across configured locations", async () => {
  const saleConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_SECTION_PATH: "property-for-sale",
    DAFT_LOCATION: "dublin,kildare",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const requested: string[] = [];
  const published: DaftFinding[] = [];
  const salePayload = {
    props: {
      pageProps: {
        listings: [
          {
            listing: {
              id: 710,
              title: "Comparable Sale",
              price: "€500,000",
              numBedrooms: "3 Bed",
              numBathrooms: "2 Bath",
              propertyType: "Semi-D",
              floorArea: { value: "105", unit: "METRES_SQUARED" },
              ber: { rating: "B2" },
              seoFriendlyPath: "/for-sale/comparable-sale/710",
            },
          },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  const soldDublinPayload = {
    props: {
      pageProps: {
        listings: [
          { listing: { id: 1001, soldPrice: "€400,000" } },
          { listing: { id: 1002, soldPrice: "€450,000" } },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  const soldKildarePayload = {
    props: {
      pageProps: {
        listings: [
          { listing: { id: 1002, soldPrice: "€450,000" } },
          { listing: { id: 1003, soldPrice: "€550,000" } },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };

  const result = await Effect.runPromise(
    runOnce(saleConfig, {
      fetchPage: (url) =>
        Effect.sync(() => {
          requested.push(url);
          if (!url.includes("/sold-properties/")) {return salePayload;}
          return new URL(url).searchParams.get("location") === "dublin"
            ? soldDublinPayload
            : soldKildarePayload;
        }),
      publish: (finding) =>
        Effect.sync(() => {
          published.push(finding);
        }),
      publishError: () => Effect.void,
      state: makeState(),
      heartbeat: () => Effect.void,
    }),
  );

  assert.equal(result.pages, 2);
  assert.equal(result.notified, 1);
  assert.equal(requested.length, 4);
  assert.deepEqual(
    requested
      .filter((url) => !url.includes("/sold-properties/"))
      .map((url) => new URL(url).pathname),
    ["/property-for-sale/dublin", "/property-for-sale/kildare"],
  );
  assert.deepEqual(
    requested
      .filter((url) => url.includes("/sold-properties/"))
      .map((url) => new URL(url).searchParams.getAll("location")),
    [["dublin"], ["kildare"]],
  );
  assert.deepEqual(defined(published[0]).soldComparison, {
    year: new Date().getFullYear(),
    comparableCount: 3,
    minPriceEur: 400000,
    maxPriceEur: 550000,
    askingPriceEur: 500000,
    verdict: "within",
  });
});
test("skips sold lookups for findings already seen", async () => {
  const saleConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_SECTION_PATH: "property-for-sale",
    DAFT_LOCATION: "dublin",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const requested: string[] = [];
  const published: DaftFinding[] = [];
  const state = makeState();
  const searchPayload = {
    props: {
      pageProps: {
        listings: [
          {
            listing: {
              id: 711,
              title: "Seen Sale",
              price: "€500,000",
              numBedrooms: "3 Bed",
              numBathrooms: "2 Bath",
              propertyType: "Semi-D",
              floorArea: { value: 105 },
              ber: { rating: "B2" },
            },
          },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  const soldPayload = {
    props: {
      pageProps: {
        listings: [{ listing: { id: 1101, soldPrice: "€450,000" } }],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  const dependencies = {
    fetchPage: (url: string) =>
      Effect.sync(() => {
        requested.push(url);
        return url.includes("/sold-properties/") ? soldPayload : searchPayload;
      }),
    publish: (finding: DaftFinding) =>
      Effect.sync(() => {
        published.push(finding);
      }),
    publishError: () => Effect.void,
    state,
    heartbeat: () => Effect.void,
  };

  const first = await Effect.runPromise(runOnce(saleConfig, dependencies));
  const second = await Effect.runPromise(runOnce(saleConfig, dependencies));

  assert.equal(first.notified, 1);
  assert.equal(second.notified, 0);
  assert.equal(published.length, 1);
  assert.equal(
    requested.filter((url) => url.includes("/sold-properties/")).length,
    1,
  );
});


test("hydrates new-home matching fields before sold comparison", async () => {
  const newHomeConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_LOCATION: "dublin",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const requested: string[] = [];
  const published: DaftFinding[] = [];
  const searchPayload = {
    props: {
      pageProps: {
        listings: [
          {
            listing: {
              id: 720,
              title: "Example Development",
              newHome: {
                subUnits: [
                  {
                    id: 721,
                    price: "€500,000",
                    numBedrooms: "3 Bed",
                    numBathrooms: "2 Bath",
                    propertyType: "Semi-D",
                    seoFriendlyPath: "/new-home-for-sale/example/721",
                  },
                ],
              },
            },
          },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  const detailPayload = {
    props: {
      pageProps: {
        listing: {
          floorArea: { value: "105", unit: "METRES_SQUARED" },
          ber: { rating: "B2" },
          addressDetails: {
            postalCode: "A12B345",
            streetAddress: "1 Example Road",
          },
        },
      },
    },
  };
  const soldPayload = {
    props: {
      pageProps: {
        listings: [
          { listing: { soldPrice: "€400,000" } },
          { listing: { soldPrice: "€450,000" } },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };

  await Effect.runPromise(
    runOnce(newHomeConfig, {
      fetchPage: (url) =>
        Effect.sync(() => {
          requested.push(url);
          if (url.includes("/sold-properties/")) {return soldPayload;}
          if (url.includes("/new-home-for-sale/")) {return detailPayload;}
          return searchPayload;
        }),
      publish: (finding) =>
        Effect.sync(() => {
          published.push(finding);
        }),
      publishError: () => Effect.void,
      state: makeState(),
      heartbeat: () => Effect.void,
    }),
  );

  assert.equal(defined(published[0]).floorSizeSqm, 105);
  assert.equal(defined(published[0]).berRating, "B2");
  assert.equal(defined(published[0]).address, "1 Example Road");
  assert.equal(defined(published[0]).eircode, "A12B345");
  assert.deepEqual(defined(published[0]).soldComparison, {
    year: new Date().getFullYear(),
    comparableCount: 2,
    minPriceEur: 400000,
    maxPriceEur: 450000,
    askingPriceEur: 500000,
    verdict: "above",
  });
});

test("seeds first results and notifies only later unseen findings", async () => {
  const state = makeState();
  const sent: string[] = [];
  let current = [makeFinding("101"), makeFinding("102")];
  const dependencies = {
    fetchPage: () => Effect.succeed(payload(current)),
    publish: (finding: DaftFinding) =>
      Effect.sync(() => {
        sent.push(finding.id);
      }),
    state,
    publishError: () => Effect.void,
    heartbeat: () => Effect.void,
  };

  const first = await Effect.runPromise(runOnce(config, dependencies));
  assert.deepEqual(first, {
    pages: 1,
    findings: 2,
    notified: 0,
    seeded: 2,
  });
  const second = await Effect.runPromise(runOnce(config, dependencies));
  assert.equal(second.notified, 0);
  current = [...current, makeFinding("103")];
  const third = await Effect.runPromise(runOnce(config, dependencies));
  assert.equal(third.notified, 1);
  assert.deepEqual(sent, ["103"]);
});

test("handles missing current rows while seeding and notifying", async () => {
  const seenKeys: string[] = [];
  const missingCurrent = makeState();
  const notifyingState: StateStore = {
    ...missingCurrent,
    getCurrentListing: () => Effect.succeed(undefined),
    isInitialized: () => Effect.succeed(true),
    isSeen: (key) => Effect.succeed(key === "daft:930"),
    markSeen: (finding) =>
      Effect.sync(() => {
        seenKeys.push(finding.id);
      }),
  };
  const published: string[] = [];
  const notifyConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const notified = await Effect.runPromise(
    runOnce(notifyConfig, {
      fetchPage: () => Effect.succeed(payload([makeFinding("930"), makeFinding("931")])),
      publish: (finding) =>
        Effect.sync(() => {
          published.push(finding.id);
        }),
      publishError: () => Effect.void,
      state: notifyingState,
      heartbeat: () => Effect.void,
    }),
  );
  assert.equal(notified.notified, 1);
  assert.deepEqual(published, ["931"]);
  assert.deepEqual(seenKeys, ["daft:930", "daft:931"]);

  const seededKeys: string[] = [];
  const seedingBase = makeState();
  const seedingState: StateStore = {
    ...seedingBase,
    getCurrentListing: () => Effect.succeed(undefined),
    markSeen: (finding) =>
      Effect.sync(() => {
        seededKeys.push(finding.id);
      }),
  };
  const seeded = await Effect.runPromise(
    runOnce(config, {
      fetchPage: () => Effect.succeed(payload([makeFinding("932")])),
      publish: () => Effect.void,
      publishError: () => Effect.void,
      state: seedingState,
      heartbeat: () => Effect.void,
    }),
  );
  assert.equal(seeded.seeded, 1);
  assert.deepEqual(seededKeys, ["daft:932"]);
});

test("notifies a finding that appears after an empty first poll", async () => {
  const state = makeState();
  const sent: string[] = [];
  const errors: Error[] = [];
  let current: DaftFinding[] = [];
  const dependencies = {
    fetchPage: () => Effect.succeed(payload(current)),
    publish: (finding: DaftFinding) =>
      Effect.sync(() => {
        sent.push(finding.id);
      }),
    state,
    publishError: (error: Error) =>
      Effect.sync(() => {
        errors.push(error);
      }),
    heartbeat: () => Effect.void,
  };

  const first = await Effect.runPromise(runOnce(config, dependencies));
  assert.equal(first.findings, 0);
  assert.equal(first.seeded, 0);
  current = [makeFinding("301")];

  const second = await Effect.runPromise(runOnce(config, dependencies));
  assert.equal(second.notified, 1);
  assert.deepEqual(sent, ["301"]);
  assert.deepEqual(errors, []);
});

test("notifies poll failures through configured publishers", async () => {
  const failure = new Error("Daft page returned HTTP 404");
  const notified: Error[] = [];

  await assert.rejects(
    Effect.runPromise(
      runOnce(config, {
        fetchPage: () => Effect.fail(failure),
        publish: () => Effect.void,
        publishError: (error: Error) =>
          Effect.sync(() => {
            notified.push(error);
          }),
        state: makeState(),
        heartbeat: () => Effect.void,
      }),
    ),
    failure,
  );

  assert.deepEqual(notified, [failure]);
});
test("logs poll notification failures without replacing the poll error", async () => {
  const failure = new Error("Daft page unavailable");
  const logs: string[] = [];
  const logger = Logger.make(({ message }) => {
    logs.push(String(message));
  });

  await assert.rejects(
    Effect.runPromise(
      runOnce(config, {
        fetchPage: () => Effect.fail(failure),
        publish: () => Effect.void,
        publishError: () => Effect.fail(new Error("publisher unavailable")),
        state: makeState(),
        heartbeat: () => Effect.void,
      }).pipe(Effect.provide(Logger.layer([logger]))),
    ),
    failure,
  );
  assert.deepEqual(logs, [
    "Could not publish poll error notification: publisher unavailable",
  ]);
});


test("writes a heartbeat and reports filesystem failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bellwatch-heartbeat-"));
  try {
    const file = join(directory, "nested", "deeper", "heartbeat");
    await Effect.runPromise(writeHeartbeat(file));
    assert.match(await readFile(file, "utf8"), /^\d{4}-\d{2}-\d{2}T/);
    await assert.rejects(
      Effect.runPromise(writeHeartbeat(directory)),
      (error: unknown) => {
        assert.match(String(error), /Could not write heartbeat/);
        assert.equal(error instanceof Error && error.cause instanceof Error, true);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("exposes a tagged monitor error", () => {
  const error = new MonitorError("poll failed");
  assert.equal(error.name, "MonitorError");
  assert.equal(error._tag, "MonitorError");
});

test("collects multiple Daft pages and deduplicates findings", async () => {
  const state = makeState();
  const sent: string[] = [];
  const firstPage = payload([makeFinding("401")]);
  firstPage.props.pageProps.paging = {
    currentPage: 1,
    totalPages: 2,
  };
  const secondPage = payload([makeFinding("402")]);
  secondPage.props.pageProps.paging = {
    currentPage: 2,
    totalPages: 2,
  };
  const urls: string[] = [];
  const dependencies = {
    fetchPage: (url: string) => {
      urls.push(url);
      return Effect.succeed(
        new URL(url).searchParams.get("page") === "2" ? secondPage : firstPage,
      );
    },
    publish: (finding: DaftFinding) =>
      Effect.sync(() => {
        sent.push(finding.id);
      }),
    state,
    publishError: () => Effect.void,
    heartbeat: () => Effect.void,
  };
  const multiPageConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });

  const result = await Effect.runPromise(runOnce(multiPageConfig, dependencies));
  assert.equal(result.pages, 2);
  assert.equal(result.findings, 2);
  assert.equal(result.notified, 2);
  assert.deepEqual(sent, ["401", "402"]);
  assert.equal(urls.length, 2);
  assert.equal(new URL(defined(urls[1])).searchParams.get("page"), "2");
});


test("honors an explicit maximum page limit", async () => {
  const state = makeState();
  const urls: string[] = [];
  const firstPage = payload([makeFinding("403")]);
  firstPage.props.pageProps.paging = {
    currentPage: 1,
    totalPages: 2,
  };
  const dependencies = {
    fetchPage: (url: string) => {
      urls.push(url);
      return Effect.succeed(firstPage);
    },
    publish: () => Effect.void,
    state,
    publishError: () => Effect.void,
    heartbeat: () => Effect.void,
  };
  const cappedConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });

  const result = await Effect.runPromise(runOnce(cappedConfig, dependencies));

  assert.equal(result.pages, 1);
  assert.equal(result.findings, 1);
  assert.equal(urls.length, 1);
});
test("searches configured locations separately and deduplicates findings", async () => {
  const state = makeState();
  const sent: string[] = [];
  const shared = makeFinding("501");
  const dublinOnly = makeFinding("502");
  const navanOnly = makeFinding("503");
  const urls: string[] = [];
  const dependencies = {
    fetchPage: (url: string) => {
      urls.push(url);
      return Effect.succeed(
        payload(
          url.includes("/dublin-city")
            ? [shared, dublinOnly]
            : [shared, navanOnly],
        ),
      );
    },
    publish: (finding: DaftFinding) =>
      Effect.sync(() => {
        sent.push(finding.id);
      }),
    state,
    publishError: () => Effect.void,
    heartbeat: () => Effect.void,
  };
  const multiLocationConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_LOCATION: "dublin-city,navan-meath",
    DAFT_RADIUS_KM: "20",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });

  const result = await Effect.runPromise(runOnce(multiLocationConfig, dependencies));

  assert.equal(result.pages, 2);
  assert.equal(result.findings, 3);
  assert.equal(result.notified, 3);
  assert.deepEqual(sent, ["501", "502", "503"]);
  assert.equal(urls.length, 2);
  const firstUrl = new URL(defined(urls[0]));
  const secondUrl = new URL(defined(urls[1]));
  assert.equal(firstUrl.pathname, "/new-homes-for-sale/dublin-city");
  assert.equal(firstUrl.searchParams.get("radius"), "20000");
  assert.equal(firstUrl.searchParams.get("location"), null);
  assert.equal(secondUrl.pathname, "/new-homes-for-sale/navan-meath");
  assert.equal(secondUrl.searchParams.get("radius"), "20000");
  assert.equal(secondUrl.searchParams.get("location"), null);
});

test("applies exclusive SHPS filtering before state and notifications", async () => {
  const state = makeState();
  const sent: string[] = [];
  const detailUrls: string[] = [];
  const descriptions = new Map([
    [
      "601",
      "This home is offered under the Starter Home Purchase Scheme. " +
        "The local authority retains an equity share.",
    ],
    [
      "602",
      "This home is available under both the Help to Buy scheme and the " +
        "Starter Home Purchase Scheme.",
    ],
    [
      "603",
      "This home is offered under the Starter Home Purchase Scheme. " +
        "The upfront price is reduced by a local-authority equity share.",
    ],
  ]);
  const dependencies = {
    fetchPage: (url: string) => {
      if (url.includes("/new-home-for-sale/example/")) {
        detailUrls.push(url);
        const id = url.split("/").at(-1);
        const description = id ? descriptions.get(id) : undefined;
        assert.ok(description);
        return Effect.succeed(detailPayload(description));
      }
      return Effect.succeed(
        payload([
          makeFinding("601", { priceText: "€350,000" }),
          makeFinding("602", { priceText: "€350,001" }),
          makeFinding("603", { priceText: "Price unavailable" }),
        ]),
      );
    },
    publish: (finding: DaftFinding) =>
      Effect.sync(() => {
        sent.push(finding.id);
      }),
    state,
    publishError: () => Effect.void,
    heartbeat: () => Effect.void,
  };
  const shpsConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    SHPS_FILTER: "only",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });

  const result = await Effect.runPromise(runOnce(shpsConfig, dependencies));

  assert.equal(result.findings, 2);
  assert.equal(result.notified, 2);
  assert.deepEqual(sent, ["601", "603"]);
  assert.equal(detailUrls.length, 3);
});

test("excludes SHPS-only findings before state and notifications", async () => {
  const state = makeState();
  const sent: string[] = [];
  const descriptions = new Map([
    [
      "701",
      "This home is offered under the Starter Home Purchase Scheme. " +
        "The local authority retains an equity share.",
    ],
    [
      "702",
      "This home is available under both the Help to Buy scheme and the " +
        "Starter Home Purchase Scheme.",
    ],
    ["703", "This is a private new home with no named purchase scheme."],
  ]);
  const dependencies = {
    fetchPage: (url: string) => {
      if (url.includes("/new-home-for-sale/example/")) {
        const id = url.split("/").at(-1);
        const description = id ? descriptions.get(id) : undefined;
        assert.ok(description);
        return Effect.succeed(detailPayload(description));
      }
      return Effect.succeed(
        payload([makeFinding("701"), makeFinding("702"), makeFinding("703")]),
      );
    },
    publish: (finding: DaftFinding) =>
      Effect.sync(() => {
        sent.push(finding.id);
      }),
    state,
    publishError: () => Effect.void,
    heartbeat: () => Effect.void,
  };
  const shpsConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    SHPS_FILTER: "exclude",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });

  const result = await Effect.runPromise(runOnce(shpsConfig, dependencies));

  assert.equal(result.findings, 2);
  assert.equal(result.notified, 2);
  assert.deepEqual(sent, ["702", "703"]);
});

test("wraps a Daft parsing failure with its cause", async () => {
  const cause = new Error("malformed page");
  const badPayload = new Proxy(
    {},
    {
      get: () => {
        throw cause;
      },
    },
  );
  await assert.rejects(
    Effect.runPromise(
      runOnce(config, {
        fetchPage: () => Effect.succeed(badPayload),
        publish: () => Effect.void,
        state: makeState(),
        publishError: () => Effect.void,
        heartbeat: () => Effect.void,
      }),
    ),
    (error: unknown) => {
      assert.match(String(error), /Could not parse Daft page 1 for Ireland/);
      assert.ok(error instanceof Error);
      assert.equal(error.cause, cause);
      return true;
    },
  );
});

test("keeps an id unseen when notification delivery fails", async () => {
  const state = makeState();
  let attempts = 0;
  const finding = makeFinding("201");
  const dependencies = {
    fetchPage: () => Effect.succeed(payload([finding])),
    publish: () => {
      attempts += 1;
      return attempts === 1
        ? Effect.fail(new Error("temporary notification failure"))
        : Effect.void;
    },
    state,
    publishError: () => Effect.void,
    heartbeat: () => Effect.void,
  };
  const notifyingConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });

  await assert.rejects(Effect.runPromise(runOnce(notifyingConfig, dependencies)));
  const second = await Effect.runPromise(runOnce(notifyingConfig, dependencies));
  assert.equal(second.notified, 1);
  assert.equal(attempts, 2);
});

test("hydrates findings without scheme evidence before filtering", async () => {
  const finding = makeFinding("801", {
    schemeText: "Starter Home Purchase Scheme. Local authority equity share.",
  });
  const state = makeState();
  let fetches = 0;
  const sent: string[] = [];
  const shpsConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    SHPS_FILTER: "only",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const result = await Effect.runPromise(
    runOnce(shpsConfig, {
      fetchPage: (url) => {
        fetches += 1;
        return url.includes("/new-home-for-sale/example/")
          ? Effect.succeed(detailPayload(defined(finding.schemeText)))
          : Effect.succeed(payload([finding]));
      },
      publish: (value) =>
        Effect.sync(() => {
          sent.push(value.id);
        }),
      publishError: () => Effect.void,
      state,
      heartbeat: () => Effect.void,
    }),
  );
  assert.equal(fetches, 2);
  assert.equal(result.findings, 1);
  assert.deepEqual(sent, ["801"]);
});

test("keeps findings when detail pages have no description", async () => {
  const finding = makeFinding("804");
  const sent: string[] = [];
  const result = await Effect.runPromise(
    runOnce(
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        SHPS_FILTER: "exclude",
        NOTIFY_EXISTING_ON_FIRST_RUN: "true",
      }),
      {
        fetchPage: (url) =>
          url.includes("/new-home-for-sale/example/")
            ? Effect.succeed(emptyDetailPayload())
            : Effect.succeed(payload([finding])),
        publish: (value) =>
          Effect.sync(() => {
            assert.equal(Object.hasOwn(value, "schemeText"), false);
            assert.equal(Object.hasOwn(value, "floorSizeSqm"), false);
            assert.equal(Object.hasOwn(value, "berRating"), false);
            assert.equal(Object.hasOwn(value, "address"), false);
            assert.equal(Object.hasOwn(value, "eircode"), false);
            sent.push(value.id);
          }),
        publishError: () => Effect.void,
        state: makeState(),
        heartbeat: () => Effect.void,
      },
    ),
  );
  assert.equal(result.findings, 1);
  assert.deepEqual(sent, ["804"]);
});

test("records Help to Buy evidence for Baserow when SHPS filtering is off", async () => {
  const finding = makeFinding("805");
  const description = "Eligible purchasers may use Help to Buy.";
  const state = makeState();
  let detailRequests = 0;
  const baserowConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    SHPS_FILTER: "off",
    DAFT_MAX_PAGES: "1",
    MYHOME_ENABLED: "false",
    BASEROW_BASE_URL: "http://baserow.test",
    BASEROW_TOKEN: "test-token",
    BASEROW_TABLE_ID: "listings",
  });

  const result = await Effect.runPromise(
    runOnce(baserowConfig, {
      fetchPage: (url) => {
        if (url === finding.url) {
          detailRequests += 1;
          return Effect.succeed(detailPayload(description));
        }
        return Effect.succeed(payload([finding]));
      },
      publish: () => Effect.void,
      publishError: () => Effect.void,
      state,
      heartbeat: () => Effect.void,
    }),
  );

  const observation = (await Effect.runPromise(state.listCurrentListings()))
    .find((listing) => listing.source === "daft");
  assert.equal(result.findings, 1);
  assert.equal(detailRequests, 1);
  assert.ok(observation);
  assert.equal(observation.finding.schemeText, description);
  assert.equal(
    classifyHelpToBuyEvidence(observation.finding),
    "mentioned",
  );
});

test("notifies and preserves detail-fetch failures", async () => {
  const cause = new Error("detail unavailable");
  const finding = makeFinding("802");
  const notified: Error[] = [];
  const shpsConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    SHPS_FILTER: "only",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });

  await assert.rejects(
    Effect.runPromise(
      runOnce(shpsConfig, {
        fetchPage: (url) =>
          url.includes("/new-home-for-sale/example/")
            ? Effect.fail(cause)
            : Effect.succeed(payload([finding])),
        publish: () => Effect.void,
        publishError: (error) =>
          Effect.sync(() => {
            notified.push(error);
          }),
        state: makeState(),
        heartbeat: () => Effect.void,
      }),
    ),
    (error: unknown) => {
      assert.match(String(error), /Could not fetch Daft listing/);
      assert.ok(error instanceof Error);
      assert.equal(error.cause, cause);
      return true;
    },
  );
  assert.equal(notified.length, 1);
  assert.equal(defined(notified[0]).cause, cause);
});
test("keeps comparable-only hydration failures fail-open", async () => {
  const cause = new Error("optional detail unavailable");
  const config = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_LOCATION: "dublin",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const published: DaftFinding[] = [];
  const errors: Error[] = [];
  const logs: string[] = [];
  const logger = Logger.make(({ message }) => {
    logs.push(String(message));
  });
  const searchPayload = {
    props: {
      pageProps: {
        listings: [
          {
            listing: {
              id: 805,
              title: "Optional Detail",
              price: "€400,000",
              numBedrooms: "3 Bed",
              numBathrooms: "2 Bath",
              propertyType: "Semi-D",
              newHome: {
                subUnits: [
                  {
                    id: 805,
                    price: "€400,000",
                    numBedrooms: "3 Bed",
                    numBathrooms: "2 Bath",
                    propertyType: "Semi-Detached House",
                    seoFriendlyPath: "/new-home-for-sale/listing/805",
                  },
                ],
              },
            },
          },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };

  const result = await Effect.runPromise(
    runOnce(config, {
      fetchPage: (url) =>
        url.includes("/new-home-for-sale/")
          ? Effect.fail(cause)
          : Effect.succeed(searchPayload),
      publish: (finding) =>
        Effect.sync(() => {
          published.push(finding);
        }),
      publishError: (error) =>
        Effect.sync(() => {
          errors.push(error);
        }),
      state: makeState(),
      heartbeat: () => Effect.void,
    }).pipe(Effect.provide(Logger.layer([logger]))),
  );

  assert.equal(result.notified, 1);
  assert.equal(published.length, 1);
  assert.equal(Object.hasOwn(defined(published[0]), "soldComparison"), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(logs, [
    "Could not hydrate Daft listing 805: Could not fetch Daft listing https://www.daft.ie/new-home-for-sale/listing/805",
  ]);
});


test("wraps detail parsing failures before notifying them", async () => {
  const cause = new Error("malformed detail");
  const finding = makeFinding("803");
  const badPayload = new Proxy(
    {},
    {
      get: () => {
        throw cause;
      },
    },
  );
  const notified: Error[] = [];
  const shpsConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    SHPS_FILTER: "only",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });

  await assert.rejects(
    Effect.runPromise(
      runOnce(shpsConfig, {
        fetchPage: (url) =>
          url.includes("/new-home-for-sale/example/")
            ? Effect.succeed(badPayload)
            : Effect.succeed(payload([finding])),
        publish: () => Effect.void,
        publishError: (error) =>
          Effect.sync(() => {
            notified.push(error);
          }),
        state: makeState(),
        heartbeat: () => Effect.void,
      }),
    ),
    (error: unknown) => {
      assert.match(String(error), /Could not parse Daft listing/);
      assert.ok(error instanceof Error);
      assert.equal(error.cause, cause);
      return true;
    },
  );

  assert.equal(notified.length, 1);
});

test("fetches paginated sold comparables and preserves their range", async () => {
  const saleConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_SECTION_PATH: "property-for-sale",
    DAFT_LOCATION: "dublin",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const requested: string[] = [];
  const published: DaftFinding[] = [];
  const searchPayload = {
    props: {
      pageProps: {
        listings: [
          {
            listing: {
              id: 730,
              title: "Paginated Sale",
              price: "€500,000",
              numBedrooms: "3 Bed",
              numBathrooms: "2 Bath",
              propertyType: "Semi-D",
              floorArea: { value: 105 },
              ber: { rating: "B2" },
              seoFriendlyPath: "/for-sale/paginated-sale/730",
            },
          },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  const soldPayload = (prices: readonly string[], page: number) => ({
    props: {
      pageProps: {
        listings: prices.map((soldPrice) => ({ listing: { soldPrice } })),
        paging: { currentPage: page, totalPages: 2 },
      },
    },
  });

  const result = await Effect.runPromise(
    runOnce(saleConfig, {
      fetchPage: (url) =>
        Effect.sync(() => {
          requested.push(url);
          if (!url.includes("/sold-properties/")) {return searchPayload;}
          return new URL(url).searchParams.get("page") === null
            ? soldPayload(["€400,000"], 1)
            : soldPayload(["€450,000"], 2);
        }),
      publish: (finding) =>
        Effect.sync(() => {
          published.push(finding);
        }),
      publishError: () => Effect.void,
      state: makeState(),
      heartbeat: () => Effect.void,
    }),
  );

  const soldRequests = requested.filter((url) =>
    url.includes("/sold-properties/"),
  );
  assert.deepEqual(
    soldRequests.map((url) => new URL(url).searchParams.get("page")),
    [null, "2"],
  );
  assert.equal(result.findings, 1);
  assert.equal(defined(published[0]).soldComparison?.comparableCount, 2);
  assert.equal(defined(published[0]).soldComparison?.minPriceEur, 400_000);
  assert.equal(defined(published[0]).soldComparison?.maxPriceEur, 450_000);
});

test("caches sold lookup failures for duplicate comparable requests", async () => {
  const saleConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_SECTION_PATH: "property-for-sale",
    DAFT_LOCATION: "dublin",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const published: DaftFinding[] = [];
  let soldRequests = 0;
  const searchPayload = {
    props: {
      pageProps: {
        listings: [731, 732, 733].map((id) => ({
          listing: {
            id,
            title: "Same Comparable Request",
            price: id === 733 ? "€501,000" : "€500,000",
            numBedrooms: "3 Bed",
            numBathrooms: "2 Bath",
            propertyType: "Semi-D",
            floorArea: { value: 105 },
            ber: { rating: "B2" },
          },
        })),
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  const cause = new Error("sold service unavailable");
  const logs: string[] = [];
  const logger = Logger.make(({ message }) => {
    logs.push(String(message));
  });
  const result = await Effect.runPromise(
    runOnce(saleConfig, {
      fetchPage: (url) => {
        if (!url.includes("/sold-properties/")) {
          return Effect.succeed(searchPayload);
        }
        soldRequests += 1;
        return Effect.fail(cause);
      },
      publish: (finding) =>
        Effect.sync(() => {
          published.push(finding);
        }),
      publishError: () => Effect.void,
      state: makeState(),
      heartbeat: () => Effect.void,
    }).pipe(Effect.provide(Logger.layer([logger]))),
  );

  assert.equal(result.findings, 3);
  assert.equal(result.notified, 3);
  assert.equal(soldRequests, 2);
  assert.equal(Object.hasOwn(defined(published[0]), "soldComparison"), false);
  assert.equal(Object.hasOwn(defined(published[1]), "soldComparison"), false);
  assert.equal(Object.hasOwn(defined(published[2]), "soldComparison"), false);
  assert.deepEqual(logs, [
    "Could not load sold comparables for 731: Could not fetch sold comparables for Semi-D",
    "Could not load sold comparables for 733: Could not fetch sold comparables for Semi-D",
  ]);
});

test("skips sold requests when hydrated finding lacks spatial evidence", async () => {
  const newHomeConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const requested: string[] = [];
  const searchPayload = {
    props: {
      pageProps: {
        listings: [
          {
            listing: {
              id: 740,
              title: "No Spatial Evidence",
              newHome: {
                subUnits: [
                  {
                    id: 741,
                    price: "€500,000",
                    numBedrooms: "3 Bed",
                    numBathrooms: "2 Bath",
                    propertyType: "Semi-D",
                    floorArea: { value: 105 },
                    ber: { rating: "B2" },
                    seoFriendlyPath: "/new-home-for-sale/no-spatial/741",
                  },
                ],
              },
            },
          },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  const published: DaftFinding[] = [];
  await Effect.runPromise(
    runOnce(newHomeConfig, {
      fetchPage: (url) =>
        Effect.sync(() => {
          requested.push(url);
          return url.includes("/new-home-for-sale/no-spatial/")
            ? emptyDetailPayload()
            : searchPayload;
        }),
      publish: (finding) =>
        Effect.sync(() => {
          published.push(finding);
        }),
      publishError: () => Effect.void,
      state: makeState(),
      heartbeat: () => Effect.void,
    }),
  );

  assert.equal(requested.length, 2);
  assert.equal(
    requested.some((url) => url.includes("/sold-properties/")),
    false,
  );
  assert.equal(Object.hasOwn(defined(published[0]), "soldComparison"), false);
});


test("uses one address-based sold request without hydrating complete findings", async () => {
  const newHomeConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const requested: string[] = [];
  const published: DaftFinding[] = [];
  const searchPayload = {
    props: {
      pageProps: {
        listings: [
          {
            listing: {
              id: 750,
              title: "Address-Based Development",
              newHome: {
                subUnits: [
                  {
                    id: 751,
                    price: "€500,000",
                    numBedrooms: "3 Bed",
                    numBathrooms: "2 Bath",
                    propertyType: "Semi-D",
                    floorArea: { value: 105 },
                    ber: { rating: "B2" },
                    addressDetails: { streetAddress: "1 Main Street" },
                  },
                  {
                    id: 752,
                    price: "€500,000",
                    numBedrooms: "3 Bed",
                    numBathrooms: "2 Bath",
                    propertyType: "Semi-D",
                    floorArea: { value: 105 },
                    ber: { rating: "B2" },
                    addressDetails: { postalCode: "A12B345" },
                  },
                ],
              },
            },
          },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  const soldPayload = {
    props: {
      pageProps: {
        listings: [{ listing: { soldPrice: "€450,000" } }],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  await Effect.runPromise(
    runOnce(newHomeConfig, {
      fetchPage: (url) =>
        Effect.sync(() => {
          requested.push(url);
          return url.includes("/sold-properties/") ? soldPayload : searchPayload;
        }),
      publish: (finding) =>
        Effect.sync(() => {
          published.push(finding);
        }),
      publishError: () => Effect.void,
      state: makeState(),
      heartbeat: () => Effect.void,
    }),
  );
  assert.equal(
    requested.some((url) => url.includes("/new-home-for-sale/")),
    false,
  );
  assert.equal(
    requested.filter((url) => url.includes("/sold-properties/")).length,
    2,
  );
  assert.equal(defined(published[0]).soldComparison?.comparableCount, 1);
  assert.equal(defined(published[1]).soldComparison?.comparableCount, 1);
});

test("hydrates all findings when one comparable needs detail data", async () => {
  const newHomeConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_LOCATION: "dublin",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const detailUrls: string[] = [];
  const published: DaftFinding[] = [];
  const searchPayload = {
    props: {
      pageProps: {
        listings: [
          {
            listing: {
              id: 760,
              title: "Mixed Development",
              newHome: {
                subUnits: [
                  {
                    id: 761,
                    price: "€500,000",
                    numBedrooms: "3 Bed",
                    numBathrooms: "2 Bath",
                    propertyType: "Semi-D",
                    floorArea: { value: 105 },
                    ber: { rating: "B2" },
                    addressDetails: { streetAddress: "1 Main Street" },
                  },
                  {
                    id: 762,
                    price: "€500,000",
                    numBedrooms: "3 Bed",
                    numBathrooms: "2 Bath",
                    propertyType: "Semi-D",
                  },
                ],
              },
            },
          },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  const detail = {
    props: {
      pageProps: {
        listing: {
          floorArea: { value: 105 },
          ber: { rating: "B2" },
          addressDetails: { streetAddress: "1 Main Street" },
        },
      },
    },
  };
  const sold = {
    props: {
      pageProps: {
        listings: [{ listing: { soldPrice: "€450,000" } }],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  await Effect.runPromise(
    runOnce(newHomeConfig, {
      fetchPage: (url) =>
        Effect.sync(() => {
          if (url.includes("/sold-properties/")) {return sold;}
          if (url.includes("/new-home-for-sale/")) {
            detailUrls.push(url);
            return detail;
          }
          return searchPayload;
        }),
      publish: (finding) =>
        Effect.sync(() => {
          published.push(finding);
        }),
      publishError: () => Effect.void,
      state: makeState(),
      heartbeat: () => Effect.void,
    }),
  );
  assert.equal(detailUrls.length, 2);
  assert.equal(published.length, 2);
});
test("does not hydrate sale findings missing one bedroom field", async () => {
  const saleConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_SECTION_PATH: "property-for-sale",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const requested: string[] = [];
  const published: DaftFinding[] = [];
  const searchPayload = {
    props: {
      pageProps: {
        listings: [
          {
            listing: {
              id: 780,
              title: "Missing Bedrooms",
              price: "€400,000",
              numBathrooms: "2 Bath",
              propertyType: "Semi-D",
              floorArea: { value: 100 },
              ber: { rating: "B2" },
              seoFriendlyPath: "/for-sale/missing-bedrooms/780",
            },
          },
          {
            listing: {
              id: 781,
              title: "Missing Bathrooms",
              price: "€400,000",
              numBedrooms: "3 Bed",
              propertyType: "Semi-D",
              floorArea: { value: 100 },
              ber: { rating: "B2" },
              seoFriendlyPath: "/for-sale/missing-bathrooms/781",
            },
          },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  const result = await Effect.runPromise(
    runOnce(saleConfig, {
      fetchPage: (url) =>
        Effect.sync(() => {
          requested.push(url);
          return searchPayload;
        }),
      publish: (finding) =>
        Effect.sync(() => {
          published.push(finding);
        }),
      publishError: () => Effect.void,
      state: makeState(),
      heartbeat: () => Effect.void,
    }),
  );

  assert.equal(result.findings, 1);
  assert.equal(published.length, 1);
  assert.equal(requested.length, 1);
});
test("hydrates spatially incomplete property-sale findings", async () => {
  const saleConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_SECTION_PATH: "property-for-sale",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const requested: string[] = [];
  const searchPayload = {
    props: {
      pageProps: {
        listings: [
          {
            listing: {
              id: 790,
              title: "Spatially Incomplete Sale",
              price: "€400,000",
              numBedrooms: "3 Bed",
              numBathrooms: "2 Bath",
              propertyType: "Semi-D",
              floorArea: { value: 100 },
              ber: { rating: "B2" },
              seoFriendlyPath: "/for-sale/spatially-incomplete/790",
            },
          },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  const result = await Effect.runPromise(
    runOnce(saleConfig, {
      fetchPage: (url) =>
        Effect.sync(() => {
          requested.push(url);
          return url.includes("/for-sale/") && !url.includes("/ireland")
            ? emptyDetailPayload()
            : searchPayload;
        }),
      publish: () => Effect.void,
      publishError: () => Effect.void,
      state: makeState(),
      heartbeat: () => Effect.void,
    }),
  );

  assert.equal(result.findings, 1);
  assert.equal(requested.length, 2);
  assert.equal(
    requested.some((url) => url.includes("/sold-properties/")),
    false,
  );
});
test("does not hydrate complete new-home findings when a location supplies spatial evidence", async () => {
  const newHomeConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_LOCATION: "dublin",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const requested: string[] = [];
  const searchPayload = {
    props: {
      pageProps: {
        listings: [
          {
            listing: {
              id: 795,
              title: "Located Development",
              newHome: {
                subUnits: [
                  {
                    id: 796,
                    price: "€400,000",
                    numBedrooms: "3 Bed",
                    numBathrooms: "2 Bath",
                    propertyType: "Semi-D",
                    floorArea: { value: 100 },
                    ber: { rating: "B2" },
                    seoFriendlyPath: "/new-home-for-sale/located/796",
                  },
                ],
              },
            },
          },
        ],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  const soldPayload = {
    props: {
      pageProps: {
        listings: [{ listing: { soldPrice: "€350,000" } }],
        paging: { currentPage: 1, totalPages: 1 },
      },
    },
  };
  await Effect.runPromise(
    runOnce(newHomeConfig, {
      fetchPage: (url) =>
        Effect.sync(() => {
          requested.push(url);
          return url.includes("/sold-properties/") ? soldPayload : searchPayload;
        }),
      publish: () => Effect.void,
      publishError: () => Effect.void,
      state: makeState(),
      heartbeat: () => Effect.void,
    }),
  );

  assert.equal(requested.length, 2);
  assert.equal(
    requested.some((url) => url.includes("/new-home-for-sale/")),
    false,
  );
});
test("keeps cross-provider duplicates and notifies independent listings", async () => {
  const state = makeState();
  await Effect.runPromise(state.markInitialized());
  const daftFinding = makeFinding("901", {
    title: "Example Grove three-bedroom house",
    developmentTitle: "Example Grove",
    propertyType: "Semi-detached house",
    floorSizeSqm: 120,
    address: "1 Example Grove",
    eircode: "D01 AB12",
  });
  const listHtml =
    `<main>` +
    `<article><a href="/residential/example-grove/901">Example Grove</a></article>` +
    `<article><a href="/residential/other-grove/902">Other Grove</a></article>` +
    `</main>`;
  const detailHtml =
    `<main><h1>Example Grove three-bedroom house</h1><dl>` +
    `<dt>Property Type</dt><dd>Semi-detached house</dd>` +
    `<dt>Price</dt><dd>€340,000</dd>` +
    `<dt>Bedrooms</dt><dd>3</dd>` +
    `<dt>Availability</dt><dd>For Sale</dd>` +
    `<dt>Address</dt><dd>1 Example Grove</dd>` +
    `<dt>Eircode</dt><dd>D01 AB12</dd></dl></main>`;
  const secondDetailHtml =
    `<main><h1>Other Grove three-bedroom house</h1><dl>` +
    `<dt>Property Type</dt><dd>Semi-detached house</dd>` +
    `<dt>Price</dt><dd>€360,000</dd>` +
    `<dt>Bedrooms</dt><dd>3</dd>` +
    `<dt>Availability</dt><dd>For Sale</dd>` +
    `<dt>Address</dt><dd>2 Other Grove</dd>` +
    `<dt>Eircode</dt><dd>D02 CD34</dd>` +
    `<dt>Bathrooms</dt><dd>2</dd>` +
    `<dt>Floor Area</dt><dd>120 m²</dd>` +
    `<dt>BER</dt><dd>B2</dd></dl></main>`;
  const published: DaftFinding[] = [];
  const daftRequests: string[] = [];
  const config = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const result = await Effect.runPromise(
    runOnce(config, {
      fetchPage: (url) => {
        daftRequests.push(url);
        return Effect.succeed(payload([daftFinding]));
      },
      fetchMyHomePage: (url) => {
        const parsedUrl = new URL(url);
        if (
          parsedUrl.pathname ===
          "/residential/ireland/new-homes/property-for-sale"
        ) {
          return Effect.succeed(listHtml);
        }
        return Effect.succeed(
          parsedUrl.pathname.endsWith("/902") ? secondDetailHtml : detailHtml,
        );
      },
      publish: (finding) =>
        Effect.sync(() => {
          published.push(finding);
        }),
      publishError: () => Effect.void,
      state,
      heartbeat: () => Effect.void,
    }),
  );
  const records = await Effect.runPromise(state.listCurrentListings());
  assert.equal(daftRequests.some((url) => url.includes("/sold-properties/")), false);
  assert.equal(result.findings, 3);
  assert.equal(result.notified, 2);
  assert.deepEqual(
    published.map((finding) => finding.title).sort(),
    [
      "Example Grove three-bedroom house — 3 Bed · Semi-detached house",
      "Other Grove three-bedroom house",
    ],
  );
  assert.deepEqual(
    records.map((record) => record.bellwatchKey).sort(),
    ["daft:901", "myhome:901", "myhome:902"],
  );
  assert.equal(
    records.find((record) => record.source === "daft")?.finding.url,
    daftFinding.url,
  );
  assert.equal(
    records.find((record) => record.bellwatchKey === "myhome:901")?.finding.url,
    "https://www.myhome.ie/residential/example-grove/901",
  );
  assert.equal(
    records.find((record) => record.bellwatchKey === "myhome:902")?.finding.url,
    "https://www.myhome.ie/residential/other-grove/902",
  );
  assert.equal(
    records.every(
      (record) =>
        record.dublinBoundary?.status === "unclassified" &&
        record.dublinBoundary.reason === "missing-coordinates",
    ),
    true,
  );
});
test("searches SearXNG only when configured and stores candidates as unverified", async () => {
  const candidate: DiscoveryCandidate = {
    source: "searxng",
    verified: false,
    url: "https://example.test/new-homes/possible",
    title: "Possible house listing",
    snippet: "Search-only candidate; not verified.",
    discoveredAt: "2026-10-01T12:00:00.000Z",
  };
  const state = makeState();
  const stored: DiscoveryCandidate[] = [];
  const stateWithCandidates: StateStore = {
    ...state,
    recordCandidate: (finding) =>
      Effect.sync(() => {
        stored.push(finding);
      }),
  };
  const baseConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_MAX_PAGES: "1",
  });
  let searches = 0;
  const dependencies = {
    fetchPage: () => Effect.succeed(payload([])),
    searchSearxng: (baseUrl: string) => {
      searches += 1;
      assert.equal(baseUrl, "http://searxng.test");
      return Effect.succeed({ ok: true as const, candidates: [candidate] });
    },
    publish: () => Effect.void,
    publishError: () => Effect.void,
    state: stateWithCandidates,
    heartbeat: () => Effect.void,
  };
  await Effect.runPromise(runOnce(baseConfig, dependencies));
  assert.equal(searches, 0);
  assert.equal(stored.length, 0);

  const configured = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_MAX_PAGES: "1",
    SEARXNG_BASE_URL: "http://searxng.test",
  });
  await Effect.runPromise(runOnce(configured, dependencies));
  assert.equal(searches, 1);
  assert.equal(stored[0]?.verified, false);
  assert.deepEqual(stored, [candidate]);
});
test("skips configured SearXNG when its search adapter is unavailable", async () => {
  const config = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_MAX_PAGES: "1",
    SEARXNG_BASE_URL: "http://searxng.test",
  });
  const result = await Effect.runPromise(
    runOnce(config, {
      fetchPage: () => Effect.succeed(payload([])),
      publish: () => Effect.void,
      publishError: () => Effect.void,
      state: makeState(),
      heartbeat: () => Effect.void,
    }),
  );
  assert.equal(result.findings, 0);
});
test("backfills cross-provider identity from an existing namespaced seen ID", async () => {
  const state = makeState(["daft:999"]);
  const config = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });
  const published: DaftFinding[] = [];
  const result = await Effect.runPromise(
    runOnce(config, {
      fetchPage: () =>
        Effect.succeed(
          payload([
            makeFinding("999", {
              propertyType: "Semi-detached house",
              address: "2 Example Road",
              eircode: "D02 XY34",
            }),
          ]),
        ),
      publish: (finding) =>
        Effect.sync(() => {
          published.push(finding);
        }),
      publishError: () => Effect.void,
      state,
      heartbeat: () => Effect.void,
    }),
  );
  const current = await Effect.runPromise(state.getCurrentListing("daft:999"));
  const canonicalGroupKey = current?.canonicalGroupKey;
  assert.equal(result.notified, 0);
  assert.deepEqual(published, []);
  assert.ok(canonicalGroupKey);
  assert.equal(
    await Effect.runPromise(state.isSeen("myhome:999", canonicalGroupKey)),
    true,
  );
});
test("does not fetch MyHome when an active Daft filter is unsupported", async () => {
  const unsupportedConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_LOCATION: "dublin",
    DAFT_RADIUS_KM: "5",
    DAFT_MEDIA_TYPES: "video",
    DAFT_MAX_PAGES: "1",
  });
  const warnings: string[] = [];
  const logger = Logger.make(({ message }) => {
    warnings.push(String(message));
  });
  let myHomeRequests = 0;
  const result = await Effect.runPromise(
    runOnce(unsupportedConfig, {
      fetchPage: () => Effect.succeed(payload([])),
      fetchMyHomePage: () => {
        myHomeRequests += 1;
        return Effect.succeed("");
      },
      publish: () => Effect.void,
      publishError: () => Effect.void,
      state: makeState(),
      heartbeat: () => Effect.void,
    }).pipe(Effect.provide(Logger.layer([logger]))),
  );
  assert.equal(myHomeRequests, 0);
  assert.equal(result.pages, 1);
  assert.equal(result.findings, 0);
  assert.ok(
    warnings.some(
      (message) =>
        /\bradiusKm\b/.test(message) &&
        /\bmediaTypes\b/.test(message) &&
        message.includes("unsupported"),
    ),
  );
});

test("classifies valid MyHome coordinates using the loaded county boundary", async () => {
  const configWithLocation = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_LOCATION: "dublin",
    DAFT_PROPERTY_TYPES: "houses",
  });
  const geometry: DublinBoundaryGeometry = {
    type: "Polygon",
    coordinates: [[
      [-6.3, 53.2],
      [-6.1, 53.2],
      [-6.1, 53.4],
      [-6.3, 53.4],
      [-6.3, 53.2],
    ]],
  };
  const requestedPaths: string[] = [];
  const regionHtml =
    `<script id="ng-state" type="application/json">` +
    `{"bootstrap":[{"RegionUrls":{"1":"/residential/dublin/new-homes/house-for-sale"}}]}` +
    `</script>`;
  const firstListPage =
    `<head><link rel="next" href="?page=2"></head>` +
    `<main><article><a href="/residential/example-grove/901">Example Grove</a></article></main>`;
  const secondListPage =
    `<main><article><a href="/residential/example-road/902">Example Road</a></article>` +
    `<article><a href="/residential/example-lane/903">Example Lane</a></article>` +
    `<article><a href="/residential/example-rise/904">Example Rise</a></article></main>`;
  const detailHtml = (
    title: string,
    latitude?: number,
    longitude?: number,
  ) =>
    `<main><h1>${title}</h1><dl>` +
    `<dt>Property Type</dt><dd>Semi-detached house</dd>` +
    `<dt>Price</dt><dd>€340,000</dd>` +
    `<dt>Bedrooms</dt><dd>3</dd>` +
    `<dt>Availability</dt><dd>For Sale</dd></dl>` +
    `<div${latitude === undefined ? "" : ` data-latitude="${latitude}"`}${
      longitude === undefined ? "" : ` data-longitude="${longitude}"`
    }></div></main>`;
  const state = makeState();
  const warnings: string[] = [];
  const logger = Logger.make(({ message }) => {
    warnings.push(String(message));
  });
  let boundaryLoads = 0;
  const result = await Effect.runPromise(
    runOnce(configWithLocation, {
      fetchPage: () => Effect.succeed(payload([])),
      fetchMyHomePage: (url) => {
        const requestUrl = new URL(url);
        const path = requestUrl.pathname;
        requestedPaths.push(`${path}${requestUrl.search}`);
        if (path === "/residential/ireland/new-homes/property-for-sale") {
          return Effect.succeed(regionHtml);
        }
        if (path === "/residential/dublin/new-homes/house-for-sale") {
          if (requestUrl.search === "") { return Effect.succeed(firstListPage); }
          if (requestUrl.search === "?page=2") { return Effect.succeed(secondListPage); }
          return Effect.fail(new Error(`Unexpected MyHome page ${requestUrl.search}`));
        }
        if (path === "/residential/example-grove/901") {
          return Effect.succeed(detailHtml("Example Grove", 53.3, -6.2));
        }
        if (path === "/residential/example-road/902") {
          return Effect.succeed(detailHtml("Example Road", 53.8, -6.2));
        }
        if (path === "/residential/example-lane/903") {
          return Effect.succeed(detailHtml("Example Lane", 53.3));
        }
        if (path === "/residential/example-rise/904") {
          return Effect.succeed(detailHtml("Example Rise", undefined, -6.2));
        }
        return Effect.fail(new Error(`Unexpected MyHome path ${path}`));
      },
      loadDublinBoundary: () => {
        boundaryLoads += 1;
        return Effect.succeed(geometry);
      },
      publish: () => Effect.void,
      publishError: () => Effect.void,
      state,
      heartbeat: () => Effect.void,
    }).pipe(Effect.provide(Logger.layer([logger]))),
  );
  assert.equal(result.pages, 3);
  assert.equal(result.findings, 4);
  assert.equal(boundaryLoads, 1);
  assert.deepEqual(requestedPaths, [
    "/residential/ireland/new-homes/property-for-sale",
    "/residential/dublin/new-homes/house-for-sale",
    "/residential/dublin/new-homes/house-for-sale?page=2",
    "/residential/example-grove/901",
    "/residential/example-road/902",
    "/residential/example-lane/903",
    "/residential/example-rise/904",
  ]);
  const myHomeRecords = (await Effect.runPromise(state.listCurrentListings()))
    .filter((record) => record.source === "myhome");
  assert.equal(myHomeRecords.length, 4);
  assert.equal(warnings.some((message) => message.includes("unverified")), false);
  const inside = myHomeRecords.find((record) => record.sourceId === "901");
  const outside = myHomeRecords.find((record) => record.sourceId === "902");
  assert.ok(inside?.dublinBoundary?.status === "classified");
  assert.equal(inside.dublinBoundary.insideCounty, true);
  assert.ok(outside?.dublinBoundary?.status === "classified");
  assert.equal(outside.dublinBoundary.insideCounty, false);
  const partial = myHomeRecords.find((record) => record.sourceId === "903");
  assert.ok(partial?.dublinBoundary?.status === "unclassified");
  assert.equal(partial.dublinBoundary.reason, "missing-coordinates");
  const longitudeOnly = myHomeRecords.find((record) => record.sourceId === "904");
  assert.ok(longitudeOnly?.dublinBoundary?.status === "unclassified");
  assert.equal(longitudeOnly.dublinBoundary.reason, "missing-coordinates");
});

test("does not load the county boundary for a longitude-only MyHome finding", async () => {
  const config = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_LOCATION: "dublin",
    DAFT_PROPERTY_TYPES: "houses",
    DAFT_MAX_PAGES: "1",
  });
  const state = makeState();
  const regionHtml =
    `<script id="ng-state" type="application/json">` +
    `{"bootstrap":[{"RegionUrls":{"1":"/residential/dublin/new-homes/house-for-sale"}}]}` +
    `</script>`;
  const listHtml =
    `<main><article><a href="/residential/example-house/905">Example House</a></article></main>`;
  const detailHtml =
    `<main><h1>Example House</h1><dl>` +
    `<dt>Property Type</dt><dd>Semi-detached house</dd>` +
    `<dt>Price</dt><dd>€340,000</dd>` +
    `<dt>Bedrooms</dt><dd>3</dd>` +
    `<dt>Availability</dt><dd>For Sale</dd></dl>` +
    `<div data-longitude="-6.2"></div></main>`;
  let boundaryLoads = 0;
  await Effect.runPromise(
    runOnce(config, {
      fetchPage: () => Effect.succeed(payload([])),
      fetchMyHomePage: (url) => {
        const path = new URL(url).pathname;
        if (path === "/residential/ireland/new-homes/property-for-sale") {
          return Effect.succeed(regionHtml);
        }
        if (path === "/residential/dublin/new-homes/house-for-sale") {
          return Effect.succeed(listHtml);
        }
        return Effect.succeed(detailHtml);
      },
      loadDublinBoundary: () => {
        boundaryLoads += 1;
        return Effect.fail(new Error("unexpected boundary load"));
      },
      publish: () => Effect.void,
      publishError: () => Effect.void,
      state,
      heartbeat: () => Effect.void,
    }),
  );
  assert.equal(boundaryLoads, 0);
  const record = (await Effect.runPromise(state.listCurrentListings()))
    .find((listing) => listing.bellwatchKey === "myhome:905");
  assert.ok(record?.dublinBoundary?.status === "unclassified");
  assert.equal(record.dublinBoundary.reason, "missing-coordinates");
});

test("keeps MyHome findings unclassified when the county boundary cannot load", async () => {
  const state = makeState();
  const warnings: string[] = [];
  const logger = Logger.make(({ message }) => {
    warnings.push(String(message));
  });
  const result = await Effect.runPromise(
    runOnce(config, {
      fetchPage: () => Effect.succeed(payload([])),
      fetchMyHomePage: (url) =>
        Effect.succeed(
          new URL(url).pathname ===
            "/residential/ireland/new-homes/property-for-sale"
            ? `<main><article><a href="/residential/example/971">Example</a></article></main>`
            : `<main><h1>Example House</h1><dl>` +
              `<dt>Property Type</dt><dd>Semi-detached house</dd>` +
              `<dt>Price</dt><dd>€340,000</dd>` +
              `<dt>Bedrooms</dt><dd>3</dd>` +
              `<dt>Availability</dt><dd>For Sale</dd></dl>` +
              `<div data-latitude="53.3" data-longitude="-6.2"></div></main>`,
        ),
      loadDublinBoundary: () =>
        Effect.fail(new Error("county source unavailable")),
      publish: () => Effect.void,
      publishError: () => Effect.void,
      state,
      heartbeat: () => Effect.void,
    }).pipe(Effect.provide(Logger.layer([logger]))),
  );
  assert.equal(result.findings, 1);
  const record = (await Effect.runPromise(state.listCurrentListings()))
    .find((listing) => listing.source === "myhome");
  assert.ok(record?.dublinBoundary?.status === "unclassified");
  assert.equal(record.dublinBoundary.reason, "boundary-unavailable");
  assert.ok(
    warnings.some(
      (message) =>
        message.includes("Dublin boundary unavailable") &&
        message.includes("county source unavailable"),
    ),
  );
});

test("keeps Daft results when MyHome source requests fail", async () => {
  const state = makeState();
  const warnings: string[] = [];
  const logger = Logger.make(({ message }) => {
    warnings.push(String(message));
  });
  const result = await Effect.runPromise(
    runOnce(config, {
      fetchPage: () => Effect.succeed(payload([makeFinding("951")])),
      fetchMyHomePage: () =>
        Effect.fail(new Error("MyHome temporarily unavailable")),
      publish: () => Effect.void,
      publishError: () => Effect.void,
      state,
      heartbeat: () => Effect.void,
    }).pipe(Effect.provide(Logger.layer([logger]))),
  );
  assert.equal(result.findings, 1);
  const records = await Effect.runPromise(state.listCurrentListings());
  assert.deepEqual(records.map((record) => record.bellwatchKey), ["daft:951"]);
  assert.ok(
    warnings.some(
      (message) =>
        message.includes("MyHome source failed") &&
        message.includes("MyHome temporarily unavailable"),
    ),
  );
});

test("isolates a MyHome detail failure without losing other source findings", async () => {
  const detailFailure = new Error("listing detail temporarily unavailable");
  const daftFinding = makeFinding("987");
  const state = makeState();
  const warnings: string[] = [];
  const published: { readonly source: string; readonly url: string }[] = [];
  const logger = Logger.make(({ message }) => {
    warnings.push(String(message));
  });
  const listHtml =
    `<main><article><a href="/residential/good-house/986">Good House</a></article>` +
    `<article><a href="/residential/broken-house/988">Broken House</a></article></main>`;
  const detailHtml =
    `<main><h1>Good House</h1><dl>` +
    `<dt>Property Type</dt><dd>Semi-detached house</dd>` +
    `<dt>Price</dt><dd>€340,000</dd>` +
    `<dt>Bedrooms</dt><dd>3</dd>` +
    `<dt>Availability</dt><dd>For Sale</dd></dl>` +
    `<div data-latitude="53.3"></div></main>`;
  const boundary: DublinBoundaryGeometry = {
    type: "Polygon",
    coordinates: [[
      [-6.3, 53.2],
      [-6.1, 53.2],
      [-6.1, 53.4],
      [-6.3, 53.4],
      [-6.3, 53.2],
    ]],
  };
  let boundaryLoads = 0;
  const resilientConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_MAX_PAGES: "1",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });

  const result = await Effect.runPromise(
    runOnce(resilientConfig, {
      fetchPage: () => Effect.succeed(payload([daftFinding])),
      fetchMyHomePage: (url) => {
        const path = new URL(url).pathname;
        if (path === "/residential/ireland/new-homes/property-for-sale") {
          return Effect.succeed(listHtml);
        }
        if (path === "/residential/broken-house/988") {
          return Effect.fail(detailFailure);
        }
        return Effect.succeed(detailHtml);
      },
      loadDublinBoundary: () => {
        boundaryLoads += 1;
        return Effect.succeed(boundary);
      },
      publish: (finding, source) =>
        Effect.sync(() => {
          published.push({ source, url: finding.url });
        }),
      publishError: () => Effect.void,
      state,
      heartbeat: () => Effect.void,
    }).pipe(Effect.provide(Logger.layer([logger]))),
  );

  const records = await Effect.runPromise(state.listCurrentListings());
  assert.equal(result.findings, 2);
  assert.equal(result.notified, 2);
  assert.deepEqual(
    records.map((record) => record.bellwatchKey).sort(),
    ["daft:987", "myhome:986"],
  );
  assert.deepEqual(
    published.map(({ source }) => source).sort(),
    ["daft", "myhome"],
  );
  assert.ok(
    published.some(
      ({ source, url }) =>
        source === "daft" && url === daftFinding.url,
    ),
  );
  assert.ok(
    published.some(
      ({ source, url }) =>
        source === "myhome" && url.endsWith("/good-house/986"),
    ),
  );
  assert.equal(boundaryLoads, 0);
  const goodMyHome = records.find((record) => record.bellwatchKey === "myhome:986");
  assert.ok(goodMyHome?.dublinBoundary?.status === "unclassified");
  assert.equal(goodMyHome.dublinBoundary.reason, "missing-coordinates");
  assert.ok(
    warnings.some(
      (message) =>
        message.includes("988") && message.includes(detailFailure.message),
    ),
  );
});

test("keeps listing collection successful when SearXNG fails", async () => {
  const searchConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_MAX_PAGES: "1",
    MYHOME_ENABLED: "false",
    SEARXNG_BASE_URL: "http://searxng.test",
  });
  const state = makeState();
  const warnings: string[] = [];
  const logger = Logger.make(({ message }) => {
    warnings.push(String(message));
  });
  const result = await Effect.runPromise(
    runOnce(searchConfig, {
      fetchPage: () => Effect.succeed(payload([makeFinding("952")])),
      searchSearxng: () => Effect.fail(new Error("SearXNG unavailable")),
      publish: () => Effect.void,
      publishError: () => Effect.void,
      state,
      heartbeat: () => Effect.void,
    }).pipe(Effect.provide(Logger.layer([logger]))),
  );
  assert.equal(result.findings, 1);
  const records = await Effect.runPromise(state.listCurrentListings());
  assert.deepEqual(records.map((record) => record.bellwatchKey), ["daft:952"]);
  assert.ok(
    warnings.some(
      (message) =>
        message.includes("SearXNG search failed") &&
        message.includes("SearXNG unavailable"),
    ),
  );
});
test("fails closed when the provider has no verified route for a location", async () => {
  const locationConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_LOCATION: "dublin",
    DAFT_PROPERTY_TYPES: "houses",
    DAFT_MAX_PAGES: "1",
  });
  const state = makeState();
  const requested: string[] = [];
  const warnings: string[] = [];
  const logger = Logger.make(({ message }) => {
    warnings.push(String(message));
  });
  const result = await Effect.runPromise(
    runOnce(locationConfig, {
      fetchPage: () => Effect.succeed(payload([])),
      fetchMyHomePage: (url) => {
        requested.push(new URL(url).pathname);
        return Effect.succeed(
          `<script id="ng-state" type="application/json">` +
          `{"bootstrap":[{"RegionUrls":{"1":"/residential/cork/new-homes/house-for-sale"}}]}` +
          `</script>`,
        );
      },
      publish: () => Effect.void,
      publishError: () => Effect.void,
      state,
      heartbeat: () => Effect.void,
    }).pipe(Effect.provide(Logger.layer([logger]))),
  );
  assert.deepEqual(requested, [
    "/residential/ireland/new-homes/property-for-sale",
  ]);
  assert.equal(result.pages, 1);
  assert.equal(result.findings, 0);
  assert.ok(warnings.some((message) => message.includes("locations")));
  assert.deepEqual(await Effect.runPromise(state.listCurrentListings()), []);
});
test("applies SHPS and qualifying-house filters before storing MyHome findings", async () => {
  const listHtml =
    `<main><article><a href="/residential/example-house/961">Example House</a></article></main>`;
  const detailHtml = (propertyType: string) =>
    `<main><h1>Example House</h1><dl>` +
    `<dt>Property Type</dt><dd>${propertyType}</dd>` +
    `<dt>Price</dt><dd>€340,000</dd>` +
    `<dt>Bedrooms</dt><dd>3</dd>` +
    `<dt>Availability</dt><dd>For Sale</dd></dl></main>`;
  const runWithDetail = async (
    environment: NodeJS.ProcessEnv,
    html: string,
  ) => {
    const state = makeState();
    const result = await Effect.runPromise(
      runOnce(parseEnvironment(environment), {
        fetchPage: () => Effect.succeed(payload([])),
        fetchMyHomePage: (url) =>
          Effect.succeed(
            new URL(url).pathname ===
              "/residential/ireland/new-homes/property-for-sale"
              ? listHtml
              : html,
          ),
        publish: () => Effect.void,
        publishError: () => Effect.void,
        state,
        heartbeat: () => Effect.void,
      }),
    );
    assert.equal(result.findings, 0);
    assert.deepEqual(await Effect.runPromise(state.listCurrentListings()), []);
  };

  await runWithDetail({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_MAX_PAGES: "1",
    SHPS_FILTER: "only",
  }, detailHtml("Semi-detached house"));
  await runWithDetail({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_MAX_PAGES: "1",
  }, detailHtml("Apartment"));
});

test("honors the configured MyHome page cap when more pages are available", async () => {
  const state = makeState();
  const requestedPaths: string[] = [];
  const firstPage =
    `<head><link rel="next" href="?page=2">` +
    `<meta name="description" content="Listings 1-20 (out of 41) for Ireland property for sale."></head>` +
    `<main><article><a href="/residential/example/981">First House</a></article></main>`;
  const laterPage =
    `<meta name="description" content="Listings 21-40 (out of 41) for Ireland property for sale.">` +
    `<main><article><a href="/residential/example/982">Second House</a></article></main>`;
  const detail =
    `<main><h1>First House</h1><dl>` +
    `<dt>Property Type</dt><dd>Semi-detached house</dd>` +
    `<dt>Price</dt><dd>€340,000</dd>` +
    `<dt>Bedrooms</dt><dd>3</dd>` +
    `<dt>Availability</dt><dd>For Sale</dd></dl></main>`;
  const limitedConfig = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_MAX_PAGES: "1",
  });
  const result = await Effect.runPromise(
    runOnce(limitedConfig, {
      fetchPage: () => Effect.succeed(payload([])),
      fetchMyHomePage: (url) => {
        const request = new URL(url);
        requestedPaths.push(`${request.pathname}${request.search}`);
        if (request.pathname === "/residential/example/981") {
          return Effect.succeed(detail);
        }
        return Effect.succeed(
          request.search === "" ? firstPage : laterPage,
        );
      },
      publish: () => Effect.void,
      publishError: () => Effect.void,
      state,
      heartbeat: () => Effect.void,
    }),
  );
  assert.equal(result.pages, 2);
  assert.equal(result.findings, 1);
  assert.deepEqual(requestedPaths, [
    "/residential/ireland/new-homes/property-for-sale",
    "/residential/example/981",
  ]);
  assert.deepEqual(
    (await Effect.runPromise(state.listCurrentListings()))
      .map((listing) => listing.bellwatchKey),
    ["myhome:981"],
  );
});

test("reports unverified active-filter evidence and excludes the listing", async () => {
  const state = makeState();
  const warnings: string[] = [];
  const logger = Logger.make(({ message }) => {
    warnings.push(String(message));
  });
  const result = await Effect.runPromise(
    runOnce(
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_PRICE_MIN_EUR: "300000",
        DAFT_MAX_PAGES: "1",
      }),
      {
        fetchPage: () => Effect.succeed(payload([])),
        fetchMyHomePage: (url) =>
          Effect.succeed(
            new URL(url).pathname ===
              "/residential/ireland/new-homes/property-for-sale"
              ? `<main><article><a href="/residential/example/983">Unpriced House</a></article></main>`
              : `<main><h1>Unpriced House</h1><dl>` +
                `<dt>Property Type</dt><dd>Semi-detached house</dd>` +
                `<dt>Bedrooms</dt><dd>3</dd>` +
                `<dt>Availability</dt><dd>For Sale</dd></dl></main>`,
          ),
        publish: () => Effect.void,
        publishError: () => Effect.void,
        state,
        heartbeat: () => Effect.void,
      },
    ).pipe(Effect.provide(Logger.layer([logger]))),
  );
  assert.equal(result.findings, 0);
  assert.deepEqual(
    await Effect.runPromise(state.listCurrentListings()),
    [],
  );
  assert.ok(
    warnings.some(
      (message) =>
        message.includes("unverified") &&
        message.includes("active-filter evidence") &&
        message.includes("1"),
    ),
    JSON.stringify({ warnings, result }),
  );
});

test("does not request a Dublin boundary without a configured loader", async () => {
  const state = makeState();
  const result = await Effect.runPromise(
    runOnce(config, {
      fetchPage: () => Effect.succeed(payload([])),
      fetchMyHomePage: (url) =>
        Effect.succeed(
          new URL(url).pathname ===
            "/residential/ireland/new-homes/property-for-sale"
            ? `<main><article><a href="/residential/example/984">Located House</a></article></main>`
            : `<main><h1>Located House</h1><dl>` +
              `<dt>Property Type</dt><dd>Semi-detached house</dd>` +
              `<dt>Price</dt><dd>€340,000</dd>` +
              `<dt>Bedrooms</dt><dd>3</dd>` +
              `<dt>Availability</dt><dd>For Sale</dd></dl>` +
              `<div data-latitude="53.3" data-longitude="-6.2"></div></main>`,
        ),
      publish: () => Effect.void,
      publishError: () => Effect.void,
      state,
      heartbeat: () => Effect.void,
    }),
  );
  assert.equal(result.findings, 1);
  const listing = (await Effect.runPromise(state.listCurrentListings()))
    .find((record) => record.source === "myhome");
  assert.ok(listing?.dublinBoundary?.status === "unclassified");
  assert.equal(listing.dublinBoundary.reason, "boundary-unavailable");
});

test("keeps listings when SearXNG returns an unsuccessful search result", async () => {
  const state = makeState();
  const warnings: string[] = [];
  const logger = Logger.make(({ message }) => {
    warnings.push(String(message));
  });
  const configWithSearch = parseEnvironment({
    SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
    DAFT_MAX_PAGES: "1",
    MYHOME_ENABLED: "false",
    SEARXNG_BASE_URL: "http://searxng.test",
  });
  const result = await Effect.runPromise(
    runOnce(configWithSearch, {
      fetchPage: () => Effect.succeed(payload([makeFinding("985")])),
      searchSearxng: () =>
        Effect.succeed({
          ok: false,
          error: {
            code: "rate-limited",
            message: "search service is temporarily busy",
          },
        }),
      publish: () => Effect.void,
      publishError: () => Effect.void,
      state,
      heartbeat: () => Effect.void,
    }).pipe(Effect.provide(Logger.layer([logger]))),
  );
  assert.equal(result.findings, 1);
  assert.deepEqual(
    (await Effect.runPromise(state.listCurrentListings()))
      .map((record) => record.bellwatchKey),
    ["daft:985"],
  );
  assert.ok(
    warnings.some(
      (message) =>
        message.toLowerCase().includes("searxng") &&
        message.includes("rate-limited"),
    ),
    JSON.stringify({ warnings, result }),
  );
});
