import { createHmac } from "node:crypto";
import * as Effect from "effect/Effect";
import type { HermesConfig } from "./config.js";
import type { DaftFinding } from "./daft/parser.js";
import { formatFindingMessage } from "./shoutrrr.js";

const RETRY_DELAYS_MS = [500, 1_000] as const;
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export class HermesError extends Error {
  readonly _tag = "HermesError";
  readonly retryable: boolean;

  constructor(
    message: string,
    options?: ErrorOptions,
    retryable = true,
  ) {
    super(message, options);
    this.name = "HermesError";
    this.retryable = retryable;
  }
}

export interface HermesTransport {
  readonly request: (url: string, init: RequestInit) => Promise<Response>;
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

const defaultTransport: HermesTransport = {
  request: (url, init) => fetch(url, init),
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

const responseDetail = async (response: Response): Promise<string> => {
  try {
    return (await response.text()).trim().slice(0, 500);
  } catch {
    return "";
  }
};

const sendHermes = async (
  config: HermesConfig,
  message: string,
  transport: HermesTransport,
): Promise<void> => {
  const body = JSON.stringify({
    message,
    chat_id: config.chatId,
  });
  const timestamp = Math.floor(transport.now() / 1_000).toString();
  const signature = createHmac("sha256", config.secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  const headers = {
    "Content-Type": "application/json",
    "X-Webhook-Timestamp": timestamp,
    "X-Webhook-Signature-V2": signature,
  };

  let lastError: HermesError | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await transport.request(config.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (response.status >= 200 && response.status < 300) return;

      const detail = await responseDetail(response);
      const retryable = response.status >= 500;
      const error = new HermesError(
        `Hermes webhook returned HTTP ${response.status}${
          detail ? `: ${detail}` : ""
        }`,
        undefined,
        retryable,
      );
      if (!retryable) throw error;
      lastError = error;
    } catch (cause) {
      if (cause instanceof HermesError && !cause.retryable) throw cause;
      lastError =
        cause instanceof HermesError
          ? cause
          : new HermesError("Hermes webhook request failed", { cause });
    }

    if (attempt < RETRY_DELAYS_MS.length) {
      await transport.sleep(RETRY_DELAYS_MS[attempt]!);
    }
  }

  throw lastError ?? new HermesError("Hermes webhook request failed");
};

export const publishHermesMessage = (
  config: HermesConfig,
  message: string,
  transport: HermesTransport = defaultTransport,
): Effect.Effect<void, HermesError> =>
  Effect.tryPromise({
    try: () => sendHermes(config, message, transport),
    catch: (cause) =>
      cause instanceof HermesError
        ? cause
        : new HermesError("Could not publish Hermes notification", { cause }),
  });

export const publishHermesFinding = (
  config: HermesConfig,
  finding: DaftFinding,
  transport: HermesTransport = defaultTransport,
): Effect.Effect<void, HermesError> =>
  publishHermesMessage(config, formatFindingMessage(finding), transport);
