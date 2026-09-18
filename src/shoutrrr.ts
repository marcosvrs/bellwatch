import { spawn, type ChildProcess } from "node:child_process";
import * as Effect from "effect/Effect";
import type { ShoutrrrConfig } from "./config.js";
import type { DaftFinding } from "./daft/parser.js";

export class ShoutrrrError extends Error {
  readonly _tag = "ShoutrrrError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ShoutrrrError";
  }
}

export type ShoutrrrRunner = (
  binary: string,
  args: readonly string[],
  message: string,
  timeoutMs: number,
) => Promise<void>;

const runShoutrrr: ShoutrrrRunner = (
  binary,
  args,
  message,
  timeoutMs,
) => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const child = spawn(binary, [...args], {
    stdio: ["pipe", "ignore", "pipe"],
  });

  let stderr = "";
  let timer: NodeJS.Timeout;
  const finish = (error?: ShoutrrrError) => {
    clearTimeout(timer);
    if (error) reject(error);
    else resolve();
  };

  timer = setTimeout(() => {
    child.kill("SIGTERM");
    finish(
      new ShoutrrrError(`Shoutrrr timed out after ${timeoutMs} milliseconds`),
    );
  }, timeoutMs);

  child.stderr!.on("data", (chunk: string | Buffer) => {
    stderr = (stderr + chunk).slice(0, 500);
  });

  child.on("error", (cause) =>
    finish(
      new ShoutrrrError("Could not start Shoutrrr notification", { cause }),
    ),
  );
  child.on("close", (code, signal) => {
    if (code === 0) {
      finish();
      return;
    }
    const detail = stderr.trim();
    finish(
      new ShoutrrrError(
        `Shoutrrr exited with ${
          signal ? `signal ${signal}` : `code ${code}`
        }${detail ? `: ${detail}` : ""}`,
      ),
    );
  });
  child.stdin!.end(message);
  return promise;
};

const formatEur = (value: number): string =>
  `€${Math.round(value).toLocaleString("en-IE")}`;

const soldComparisonLines = (
  finding: DaftFinding,
): readonly string[] => {
  const comparison = finding.soldComparison;
  if (comparison === undefined) return [];
  const range =
    comparison.minPriceEur === undefined ||
    comparison.maxPriceEur === undefined
      ? `Sold comparables ${comparison.year}: no matching sales`
      : `Sold comparables ${comparison.year}: ${formatEur(
          comparison.minPriceEur,
        )}–${formatEur(comparison.maxPriceEur)} (${
          comparison.comparableCount
        } sales)`;
  const verdict =
    comparison.verdict === "above"
      ? "Market check: potentially overpriced (asking price above comparable sold range)"
      : comparison.verdict === "within"
        ? "Market check: within comparable sold range"
        : comparison.verdict === "below"
          ? "Market check: below comparable sold range"
          : comparison.verdict === "unavailable"
            ? "Market check: asking price unavailable for comparison"
            : undefined;
  const lines = [range];
  if (verdict !== undefined) lines.push(verdict);
  return lines;
};

export const formatFindingMessage = (finding: DaftFinding): string => {
  const details = [
    `Price: ${finding.priceText}`,
    ...(finding.bedrooms === undefined
      ? []
      : [`Beds: ${finding.bedrooms}`]),
    ...(finding.bathrooms === undefined
      ? []
      : [`Baths: ${finding.bathrooms}`]),
    ...(finding.propertyType ? [`Type: ${finding.propertyType}`] : []),
    `Development: ${finding.developmentTitle}`,
    ...soldComparisonLines(finding),
    `Daft: ${finding.url}`,
  ];
  return [finding.title, ...details].join("\n");
};

export const publishMessage = (
  config: ShoutrrrConfig,
  title: string,
  message: string,
  run: ShoutrrrRunner = runShoutrrr,
): Effect.Effect<void, ShoutrrrError> =>
  Effect.tryPromise({
    try: () =>
      run(
        config.binary,
        [
          "send",
          "--url",
          config.url,
          "--message",
          "-",
          "--title",
          title,
        ],
        message,
        config.timeoutMs,
      ),
    catch: (cause) =>
      cause instanceof ShoutrrrError
        ? cause
        : new ShoutrrrError("Could not publish Shoutrrr notification", {
            cause,
          }),
  });

export const publishFinding = (
  config: ShoutrrrConfig,
  finding: DaftFinding,
  run: ShoutrrrRunner = runShoutrrr,
): Effect.Effect<void, ShoutrrrError> =>
  publishMessage(
    config,
    `${config.titlePrefix}: ${finding.title}`,
    formatFindingMessage(finding),
    run,
  );
