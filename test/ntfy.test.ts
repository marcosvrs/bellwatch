import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import {
  NtfyError,
  formatFindingMessage,
  publishFinding,
  type FetchLike,
} from "../src/ntfy.js";

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
  assert.equal(headers.get("Content-Type"), "text/plain; charset=utf-8");
  assert.equal(
    formatFindingMessage(finding),
    [
      finding.title,
      "Price: €315,000",
      "Beds: 3",
      "Baths: 2",
      "Type: Terrace",
      "Development: Example Development",
      `Daft: ${finding.url}`,
    ].join("\n"),
  );
  assert.equal(
    headers.get("Title"),
    "Daft new home: Example Development ? 3 Bed ? 2 Bath ? Terrace",
  );
  assert.equal(headers.get("Priority"), "high");
  assert.equal(headers.get("Tags"), "house,new-home");
  assert.equal(headers.get("Click"), finding.url);
  assert.match(String(request?.init?.body), /€315,000/);
  assert.match(String(request?.init?.body), /Example Development/);
});

test("formats notifications without optional unit fields", () => {
  const message = formatFindingMessage({
    ...finding,
    bedrooms: undefined,
    bathrooms: undefined,
    propertyType: undefined,
  });
  assert.equal(
    message,
    [
      finding.title,
      "Price: €315,000",
      "Development: Example Development",
      `Daft: ${finding.url}`,
    ].join("\n"),
  );
});

test("wraps a transport failure as an ntfy error", async () => {
  await assert.rejects(
    Effect.runPromise(
      publishFinding(config, finding, async () => {
        throw new Error("network down");
      }),
    ),
    (error: unknown) => {
      assert.match(String(error), /Could not publish ntfy notification/);
      const cause = (error as Error).cause;
      assert.equal(cause instanceof Error, true);
      assert.equal((cause as Error).message, "network down");
      return true;
    },
  );
});

test("omits authorization when no ntfy token is configured", async () => {
  let request: RequestInit | undefined;
  await Effect.runPromise(
    publishFinding(
      { ...config, token: undefined },
      finding,
      async (_input, init) => {
        request = init;
        return new Response("ok", { status: 200 });
      },
    ),
  );
  assert.equal(new Headers(request?.headers).has("Authorization"), false);
});

test("limits error response text and exposes a tagged ntfy error", async () => {
  const responseBody = "x".repeat(600);
  await assert.rejects(
    Effect.runPromise(
      publishFinding(
        config,
        finding,
        async () => new Response(responseBody, { status: 500 }),
      ),
    ),
    (error: unknown) => {
      const message = String(error);
      assert.match(message, /x{500}/);
      assert.equal(message.includes("x".repeat(501)), false);
      return true;
    },
  );
  const error = new NtfyError("bad");
  assert.equal(error.name, "NtfyError");
  assert.equal(error._tag, "NtfyError");
});

test("does not mark a failed ntfy response as successful", async () => {
  const fetchImpl: FetchLike = async () =>
    new Response("bad token", { status: 401, statusText: "Unauthorized" });
  await assert.rejects(
    Effect.runPromise(publishFinding(config, finding, fetchImpl)),
    /ntfy returned HTTP 401/,
  );
});
