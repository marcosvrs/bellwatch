import { stat } from "node:fs/promises";

const heartbeatFile = process.env.HEARTBEAT_FILE?.trim() || "/data/heartbeat";
const configuredMaxAge = Number(process.env.HEALTHCHECK_MAX_AGE_SECONDS ?? "");
const maxAgeSeconds =
  Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
    ? configuredMaxAge
    : 86_400;

try {
  const file = await stat(heartbeatFile);
  const ageSeconds = (Date.now() - file.mtimeMs) / 1_000;
  if (ageSeconds > maxAgeSeconds) {
    throw new Error(
      `Heartbeat is ${Math.round(ageSeconds)} seconds old (limit ${maxAgeSeconds})`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
