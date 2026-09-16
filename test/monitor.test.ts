import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import { parseEnvironment } from "../src/config.js";
import { runOnce } from "../src/monitor.js";
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
  return {
    hasAny: () => Effect.succeed(seen.size > 0),
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
