import { mkdtemp, rm } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const containerCli =
  process.env.CONTAINER_CLI?.trim() ||
  (process.platform === "darwin" ? "container" : "docker");
const image = process.env.E2E_IMAGE?.trim() || "bellwatch:e2e";
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS ?? "180000");

if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  throw new Error(`E2E_TIMEOUT_MS must be a positive integer: ${timeoutMs}`);
}

const containerName = `bellwatch-e2e-${process.pid}`;
const dataDirectory = await mkdtemp(join(tmpdir(), "bellwatch-e2e-"));
const environment = [
  ["SHOUTRRR_URL", "ntfy://127.0.0.1/bellwatch-e2e"],
  ["DAFT_PRICE_MAX_EUR", "499999"],
  ["DAFT_ADDED_IN_LAST_DAYS", "1"],
  ["DAFT_SORT", "publishDateDesc"],
  ["DAFT_MAX_PAGES", "1"],
  ["DAFT_REQUEST_DELAY_MS", "1000"],
  ["NOTIFY_EXISTING_ON_FIRST_RUN", "false"],
  ["POLL_CRON", "0 0 1 1 *"],
  ["TZ", "UTC"],
];

const runContainerCli = async (args) =>
  execFileAsync(containerCli, args, {
    maxBuffer: 1024 * 1024,
  });

const waitForFirstPoll = async () => {
  const deadline = Date.now() + timeoutMs;
  let previousLogs = "";

  while (Date.now() < deadline) {
    const { stdout, stderr } = await runContainerCli(["logs", containerName]);
    const logs = `${stdout}${stderr}`;
    const newLogs = logs.startsWith(previousLogs)
      ? logs.slice(previousLogs.length)
      : logs;
    previousLogs = logs;

    for (const line of newLogs.split(/\r?\n/).filter(Boolean)) {
      console.log(`[e2e] ${line}`);
      if (line.includes("Daft poll complete:")) return;
      if (line.includes("Daft poll failed:")) throw new Error(line);
    }

    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for a successful poll after ${timeoutMs}ms`);
};

let failure;
try {
  console.log(`Running acceptance poll from ${image} using ${containerCli}`);
  await runContainerCli([
    "run",
    "--detach",
    "--init",
    "--name",
    containerName,
    "--volume",
    `${dataDirectory}:/data`,
    ...environment.flatMap(([name, value]) => ["--env", `${name}=${value}`]),
    image,
  ]);
  await waitForFirstPoll();
  console.log("Production image completed its first Daft poll");
  await runContainerCli([
    "exec",
    containerName,
    "node",
    "dist/healthcheck.js",
  ]);
  console.log("Production image healthcheck passed");
} catch (error) {
  failure = error;
} finally {
  await runContainerCli(["rm", "--force", containerName]).catch(() => undefined);
  await rm(dataDirectory, { recursive: true, force: true });
}

if (failure !== undefined) throw failure;
