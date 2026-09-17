import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import type { HermesConfig } from "../src/config.js";
import {
  HermesError,
  publishHermesFinding,
  type HermesTransport,
} from "../src/hermes.js";

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

const config: HermesConfig = {
  url: "http://hermes:8644/webhooks/ha-notify",
  secret: "test-secret",
  chatId: "test-whatsapp-group",
  timeoutMs: 5_000,
};

const expectedMessage = [
  finding.title,
  "Price: €315,000",
  "Beds: 3",
  "Baths: 2",
  "Type: Terrace",
  "Development: Example Development",
  `Daft: ${finding.url}`,
].join("\n");

test("publishes a signed Hermes WhatsApp payload", async () => {
  let invocation: { url: string; init: RequestInit } | undefined;
  const transport: HermesTransport = {
    request: async (url, init) => {
      invocation = { url, init };
      return new Response(null, { status: 204 });
    },
    now: () => 1_700_000_000_000,
    sleep: async () => undefined,
  };

  await Effect.runPromise(publishHermesFinding(config, finding, transport));

  assert.equal(invocation?.url, config.url);
  assert.equal(invocation?.init.method, "POST");
  const headers = invocation?.init.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers["X-Webhook-Timestamp"], "1700000000");
  const body = String(invocation?.init.body);
  assert.deepEqual(JSON.parse(body), {
    message: expectedMessage,
    chat_id: config.chatId,
  });
  assert.equal(
    headers["X-Webhook-Signature-V2"],
    createHmac("sha256", config.secret)
      .update(`1700000000.${body}`, "utf8")
      .digest("hex"),
  );
});

test("retries Hermes server failures with the same signed request", async () => {
  const statuses = [503, 204];
  const sleeps: number[] = [];
  let calls = 0;
  const transport: HermesTransport = {
    request: async () => {
      const status = statuses[calls];
      calls += 1;
      return new Response(status === 503 ? "temporary failure" : null, {
        status,
      });
    },
    now: () => 1_700_000_000_000,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  };

  await Effect.runPromise(publishHermesFinding(config, finding, transport));

  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [500]);
});

test("does not retry Hermes client failures", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const transport: HermesTransport = {
    request: async () => {
      calls += 1;
      return new Response("invalid signature", { status: 401 });
    },
    now: () => 1_700_000_000_000,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  };

  await assert.rejects(
    Effect.runPromise(publishHermesFinding(config, finding, transport)),
    (error: unknown) => {
      assert.equal(error instanceof HermesError, true);
      assert.equal(
        (error as Error).message,
        "Hermes webhook returned HTTP 401: invalid signature",
      );
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test("retries network failures and preserves the final error", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const transport: HermesTransport = {
    request: async () => {
      const currentCall = calls;
      calls += 1;
      if (currentCall === 0) throw new HermesError("already wrapped");
      throw new Error("connection refused");
    },
    now: () => 1_700_000_000_000,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  };

  await assert.rejects(
    Effect.runPromise(publishHermesFinding(config, finding, transport)),
    (error: unknown) => {
      assert.equal(error instanceof HermesError, true);
      assert.equal((error as Error).message, "Hermes webhook request failed");
      return true;
    },
  );
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [500, 1_000]);
});

test("handles an unreadable Hermes error response", async () => {
  const response = {
    status: 400,
    text: async () => {
      throw new Error("body unavailable");
    },
  } as unknown as Response;
  const transport: HermesTransport = {
    request: async () => response,
    now: () => 1_700_000_000_000,
    sleep: async () => undefined,
  };

  await assert.rejects(
    Effect.runPromise(publishHermesFinding(config, finding, transport)),
    (error: unknown) => {
      assert.equal((error as Error).message, "Hermes webhook returned HTTP 400");
      return true;
    },
  );
});

test("wraps failures before the Hermes request starts", async () => {
  const transport: HermesTransport = {
    request: async () => new Response(null, { status: 204 }),
    now: () => {
      throw new Error("clock unavailable");
    },
    sleep: async () => undefined,
  };

  await assert.rejects(
    Effect.runPromise(publishHermesFinding(config, finding, transport)),
    (error: unknown) => {
      assert.equal(error instanceof HermesError, true);
      assert.equal(
        (error as Error).message,
        "Could not publish Hermes notification",
      );
      return true;
    },
  );
});
