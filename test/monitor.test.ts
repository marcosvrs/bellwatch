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
          propertyType: finding.propertyType,
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

test("does not notify apartments when houses are configured", async () => {
  const sent: string[] = [];
  const result = await Effect.runPromise(
    runOnce(
      parseEnvironment({
        SHOUTRRR_URL: "ntfy://ntfy.sh/daft",
        DAFT_MAX_PAGES: "1",
        DAFT_PROPERTY_TYPES: "houses",
        NOTIFY_EXISTING_ON_FIRST_RUN: "true",
      }),
      {
        fetchPage: () =>
          Effect.succeed(
            payload([
              makeFinding("901", { propertyType: "Terrace" }),
              makeFinding("902", { propertyType: "Apartment" }),
            ]),
          ),
        publish: (finding) =>
          Effect.sync(() => {
            sent.push(finding.id);
          }),
        publishError: () => Effect.void,
        state: makeState(),
        heartbeat: () => Effect.void,
      },
    ),
  );

  assert.deepEqual(result, {
    pages: 1,
    findings: 1,
    notified: 1,
    seeded: 0,
  });
  assert.deepEqual(sent, ["901"]);
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
test("searches configured locations in one query and deduplicates findings", async () => {
  const state = makeState();
  const sent: string[] = [];
  const shared = makeFinding("501");
  const navanOnly = makeFinding("502");
  const urls: string[] = [];
  const dependencies = {
    fetchPage: (url: string) => {
      urls.push(url);
      return Effect.succeed(payload([shared, navanOnly]));
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
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });

  const result = await Effect.runPromise(runOnce(multiLocationConfig, dependencies));

  assert.equal(result.pages, 1);
  assert.equal(result.findings, 2);
  assert.equal(result.notified, 2);
  assert.deepEqual(sent, ["501", "502"]);
  assert.equal(urls.length, 1);
  const url = new URL(urls[0]);
  assert.equal(url.pathname, "/new-homes-for-sale/ireland");
  assert.deepEqual(url.searchParams.getAll("location"), [
    "dublin-city",
    "navan-meath",
  ]);
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
      assert.match(String(error), /Could not parse Daft page 1/);
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
