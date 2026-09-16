import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import { publishFinding, type FetchLike } from "../src/ntfy.js";

const finding = {
  id: "101",
  title: "Example Development — 3 Bed · 2 Bath · Terrace",
  developmentTitle: "Example Development",
  priceText: "€315,000",
  bedrooms: 3,
  bathrooms: 2,
  propertyType: "Terrace",
  url: "https://www.daft.ie/new-home-for-sale/example/101",
  source: "unit" as const,
};

const config = {
  url: "https://ntfy.example/daft",
  token: "secret",
  titlePrefix: "Daft new home",
  priority: "high",
  tags: ["house", "new-home"],
  timeoutMs: 5000,
};

test("publishes an ntfy message with notification metadata", async () => {
  let request: { input: string | URL; init?: RequestInit } | undefined;
  const fetchImpl: FetchLike = async (input, init) => {
    request = { input, init };
    return new Response("ok", { status: 200 });
  };
  await Effect.runPromise(publishFinding(config, finding, fetchImpl));
  assert.equal(request?.input, config.url);
  assert.equal(request?.init?.method, "POST");
  const headers = new Headers(request?.init?.headers);
  assert.equal(headers.get("Authorization"), "Bearer secret");
  assert.equal(headers.get("Priority"), "high");
  assert.equal(headers.get("Tags"), "house,new-home");
  assert.equal(headers.get("Click"), finding.url);
  assert.match(String(request?.init?.body), /€315,000/);
  assert.match(String(request?.init?.body), /Example Development/);
});

test("does not mark a failed ntfy response as successful", async () => {
  const fetchImpl: FetchLike = async () =>
    new Response("bad token", { status: 401, statusText: "Unauthorized" });
  await assert.rejects(
    Effect.runPromise(publishFinding(config, finding, fetchImpl)),
    /ntfy returned HTTP 401/,
  );
});
