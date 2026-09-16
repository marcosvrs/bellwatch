import * as Effect from "effect/Effect";
import type { MonitorConfig } from "./config.js";
import type { DaftFinding } from "./daft/parser.js";

export class NtfyError extends Error {
  readonly _tag = "NtfyError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NtfyError";
  }
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export const formatFindingMessage = (finding: DaftFinding): string => {
  const details = [
    `Price: ${finding.priceText}`,
    finding.bedrooms === undefined ? undefined : `Beds: ${finding.bedrooms}`,
    finding.bathrooms === undefined
      ? undefined
      : `Baths: ${finding.bathrooms}`,
    finding.propertyType ? `Type: ${finding.propertyType}` : undefined,
    `Development: ${finding.developmentTitle}`,
    `Daft: ${finding.url}`,
  ].filter((line): line is string => line !== undefined);
  return [finding.title, ...details].join("\n");
};

export const publishFinding = (
  config: MonitorConfig["ntfy"],
  finding: DaftFinding,
  fetchImpl: FetchLike = globalThis.fetch,
): Effect.Effect<void, NtfyError> =>
  Effect.tryPromise({
    try: async () => {
      const headers: Record<string, string> = {
        "Content-Type": "text/plain; charset=utf-8",
        Title: `${config.titlePrefix}: ${finding.title}`.replace(
          /[^\x20-\x7e]/g,
          "?",
        ),
        Priority: config.priority,
        Tags: config.tags.join(","),
        Click: finding.url,
      };
      if (config.token) headers.Authorization = `Bearer ${config.token}`;

      const response = await fetchImpl(config.url, {
        method: "POST",
        headers,
        body: formatFindingMessage(finding),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (response.ok) return;
      const responseBody = (await response.text()).slice(0, 500);
      throw new NtfyError(
        `ntfy returned HTTP ${response.status}: ${responseBody}`,
      );
    },
    catch: (cause) =>
      cause instanceof NtfyError
        ? cause
        : new NtfyError("Could not publish ntfy notification", { cause }),
  });
