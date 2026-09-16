import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as Effect from "effect/Effect";
import { createStateStore } from "../src/state.js";

const finding = {
  id: "101",
  title: "Example",
  developmentTitle: "Example",
  priceText: "€315,000",
  url: "https://www.daft.ie/new-home-for-sale/example/101",
  source: "unit" as const,
};

test("SQLite state survives reopening and suppresses duplicate ids", async () => {
  const directory = await mkdtemp(join(tmpdir(), "daft-house-search-"));
  const file = join(directory, "state.sqlite");
  try {
    const first = await Effect.runPromise(createStateStore({ file }));
    assert.equal(await Effect.runPromise(first.hasAny()), false);
    await Effect.runPromise(first.markSeen(finding));
    assert.equal(await Effect.runPromise(first.hasAny()), true);
    assert.equal(await Effect.runPromise(first.isSeen("101")), true);
    assert.equal(await Effect.runPromise(first.isSeen("102")), false);
    await Effect.runPromise(first.close());

    const second = await Effect.runPromise(createStateStore({ file }));
    assert.equal(await Effect.runPromise(second.isSeen("101")), true);
    await Effect.runPromise(second.close());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
