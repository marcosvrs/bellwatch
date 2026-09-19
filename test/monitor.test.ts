import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import { parseEnvironment } from "../src/config.js";
import { MonitorError, runOnce, writeHeartbeat } from "../src/monitor.js";
import type { DaftFinding } from "../src/daft/parser.js";
import type { StateStore } from "../src/state.js";

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

const makeState = (): StateStore => {
  const seen = new Set<string>();
  let initialized = false;
  return {
    isInitialized: () => Effect.succeed(initialized),
    markInitialized: () =>
      Effect.sync(() => {
        initialized = true;
      }),
    isSeen: (id) => Effect.succeed(seen.has(id)),
    markSeen: (finding) =>
      Effect.sync(() => {
        seen.add(finding.id);
      }),
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
          newHome: { subUnits: [] },
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
                    numBedrooms: "1 Bed",
                    numBathrooms: "1 Bath",
                    propertyType: "Apartment",
                    floorArea: { value: 70 },
                    ber: { rating: "B2" },
                    seoFriendlyPath: "/for-rent/riverside-apartments/701",
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
  assert.equal(new URL(requested[0]).pathname, "/property-for-rent/ireland");
  assert.equal(requested.length, 1);
  assert.equal(new URL(requested[0]).searchParams.get("rentalPrice_to"), "2500");
  assert.equal(
    requested.some((url) => url.includes("/sold-properties/")),
    false,
  );
  assert.equal(Object.hasOwn(published[0], "soldComparison"), false);
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
  assert.equal(new URL(requested[1]).pathname, "/sold-properties/ireland/semi-detached-houses");
  assert.deepEqual(published[0].soldComparison, {
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
          if (!url.includes("/sold-properties/")) return salePayload;
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
  assert.deepEqual(published[0].soldComparison, {
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
          if (url.includes("/sold-properties/")) return soldPayload;
          if (url.includes("/new-home-for-sale/")) return detailPayload;
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

  assert.equal(published[0].floorSizeSqm, 105);
  assert.equal(published[0].berRating, "B2");
  assert.equal(published[0].address, "1 Example Road");
  assert.equal(published[0].eircode, "A12B345");
  assert.deepEqual(published[0].soldComparison, {
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
        assert.equal((error as Error).cause instanceof Error, true);
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
  assert.equal(new URL(urls[1]).searchParams.get("page"), "2");
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
  const firstUrl = new URL(urls[0]);
  const secondUrl = new URL(urls[1]);
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
      assert.equal((error as Error).cause, cause);
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
          ? Effect.succeed(detailPayload(finding.schemeText!))
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
      assert.equal((error as Error).cause, cause);
      return true;
    },
  );
  assert.equal(notified.length, 1);
  assert.equal(notified[0].cause, cause);
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
              newHome: { subUnits: [] },
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
    }),
  );

  assert.equal(result.notified, 1);
  assert.equal(published.length, 1);
  assert.equal(Object.hasOwn(published[0], "soldComparison"), false);
  assert.deepEqual(errors, []);
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
      assert.equal((error as Error).cause, cause);
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
          if (!url.includes("/sold-properties/")) return searchPayload;
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
  assert.equal(published[0].soldComparison?.comparableCount, 2);
  assert.equal(published[0].soldComparison?.minPriceEur, 400_000);
  assert.equal(published[0].soldComparison?.maxPriceEur, 450_000);
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
  assert.equal(Object.hasOwn(published[0], "soldComparison"), false);
  assert.equal(Object.hasOwn(published[1], "soldComparison"), false);
  assert.equal(Object.hasOwn(published[2], "soldComparison"), false);
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
  assert.equal(Object.hasOwn(published[0], "soldComparison"), false);
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
  assert.equal(published[0].soldComparison?.comparableCount, 1);
  assert.equal(published[1].soldComparison?.comparableCount, 1);
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
          if (url.includes("/sold-properties/")) return sold;
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

  assert.equal(result.findings, 2);
  assert.equal(published.length, 2);
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