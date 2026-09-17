import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as Effect from "effect/Effect";
import { parseEnvironment } from "../src/config.js";
import { MonitorError, runOnce, writeHeartbeat } from "../src/monitor.js";
import type { DaftFinding } from "../src/daft/parser.js";
import type { Lease } from "../src/lease.js";
import type { StateStore } from "../src/state.js";

const makeFinding = (id: string): DaftFinding => ({
  id,
  title: `Development ${id}`,
  developmentTitle: `Development ${id}`,
  priceText: "€315,000",
  url: `https://www.daft.ie/new-home-for-sale/example/${id}`,
  source: "development",
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

const lease: Lease = {
  acquire: () => Effect.succeed(true),
  release: () => Effect.void,
  close: () => Effect.void,
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
      paging: { currentPage: 1, totalPages: 1, totalResults: findings.length },
    },
  },
});

const config = parseEnvironment({
  NTFY_URL: "https://ntfy.example/daft",
  DAFT_MAX_PAGES: "1",
  NOTIFY_EXISTING_ON_FIRST_RUN: "false",
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
    lease,
    heartbeat: () => Effect.void,
  };

  const first = await Effect.runPromise(runOnce(config, dependencies));
  assert.deepEqual(first, {
    pages: 1,
    findings: 2,
    notified: 0,
    seeded: 2,
    skipped: false,
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
  let current: DaftFinding[] = [];
  const dependencies = {
    fetchPage: () => Effect.succeed(payload(current)),
    publish: (finding: DaftFinding) =>
      Effect.sync(() => {
        sent.push(finding.id);
      }),
    state,
    lease,
    heartbeat: () => Effect.void,
  };

  const first = await Effect.runPromise(runOnce(config, dependencies));
  assert.equal(first.findings, 0);
  assert.equal(first.seeded, 0);
  current = [makeFinding("301")];

  const second = await Effect.runPromise(runOnce(config, dependencies));
  assert.equal(second.notified, 1);
  assert.deepEqual(sent, ["301"]);
});

test("skips a poll when the distributed lease is unavailable", async () => {
  const skippedLease: Lease = {
    acquire: () => Effect.succeed(false),
    release: () => Effect.void,
    close: () => Effect.void,
  };
  const result = await Effect.runPromise(
    runOnce(config, {
      fetchPage: () => Effect.fail(new Error("fetchPage must not run")),
      publish: () => Effect.fail(new Error("publish must not run")),
      state: makeState(),
      lease: skippedLease,
      heartbeat: () => Effect.fail(new Error("heartbeat must not run")),
    }),
  );
  assert.deepEqual(result, {
    pages: 0,
    findings: 0,
    notified: 0,
    seeded: 0,
    skipped: true,
  });
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
    totalResults: 2,
  };
  const secondPage = payload([makeFinding("402")]);
  secondPage.props.pageProps.paging = {
    currentPage: 2,
    totalPages: 2,
    totalResults: 2,
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
    lease,
    heartbeat: () => Effect.void,
  };
  const multiPageConfig = parseEnvironment({
    NTFY_URL: "https://ntfy.example/daft",
    DAFT_MAX_PAGES: "3",
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
        lease,
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
        ? Effect.fail(new Error("temporary ntfy failure"))
        : Effect.void;
    },
    state,
    lease,
    heartbeat: () => Effect.void,
  };
  const notifyingConfig = parseEnvironment({
    NTFY_URL: "https://ntfy.example/daft",
    NOTIFY_EXISTING_ON_FIRST_RUN: "true",
  });

  await assert.rejects(Effect.runPromise(runOnce(notifyingConfig, dependencies)));
  const second = await Effect.runPromise(runOnce(notifyingConfig, dependencies));
  assert.equal(second.notified, 1);
  assert.equal(attempts, 2);
});
