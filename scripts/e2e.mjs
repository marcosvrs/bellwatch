import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
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

const suffix = `${process.pid}-${Date.now()}`;
const containerName = `bellwatch-e2e-${suffix}`;
const fixtureContainerName = `bellwatch-e2e-fixture-${suffix}`;
const networkName = `bellwatch-e2e-network-${suffix}`;
const dataDirectory = await mkdtemp(join(tmpdir(), "bellwatch-e2e-"));
const environment = [
  ["SHOUTRRR_URL", "ntfy://127.0.0.1/bellwatch-e2e"],
  ["DAFT_BASE_URL", "http://daft-fixture:8080"],
  ["DAFT_PRICE_MAX_EUR", "499999"],
  ["DAFT_ADDED_IN_LAST_DAYS", "1"],
  ["DAFT_SORT", "publishDateDesc"],
  ["DAFT_MAX_PAGES", "1"],
  ["DAFT_REQUEST_DELAY_MS", "1000"],
  ["NOTIFY_EXISTING_ON_FIRST_RUN", "false"],
  ["POLL_CRON", "0 0 1 1 *"],
  ["TZ", "UTC"],
];
const fixtureScript = `
import { createServer } from "node:http";

const payload = ${JSON.stringify({
  props: {
    pageProps: {
      listings: [
        {
          listing: {
            id: 900001,
            title: "Bellwatch e2e fixture",
            price: 315000,
            seoFriendlyPath: "/new-home-for-sale/e2e/900001",
            newHome: { subUnits: [] },
          },
        },
      ],
      paging: { currentPage: 1, totalPages: 1 },
    },
  },
})};
const page = \`<!doctype html><html><body><script id="__NEXT_DATA__" type="application/json">\${JSON.stringify(payload)}</script></body></html>\`;
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://daft-fixture:8080");
  if (url.pathname === "/robots.txt") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("User-agent: *\\\\nAllow: /\\\\n");
    return;
  }
  if (url.pathname.startsWith("/new-homes-for-sale/")) {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(page);
    return;
  }
  response.writeHead(404);
  response.end();
});
server.listen(8080, "0.0.0.0", () => console.log("fixture ready"));
`;

const runContainerCli = async (args) =>
  execFileAsync(containerCli, args, {
    maxBuffer: 1024 * 1024,
  });

const waitForLog = async (name, marker) => {
  const deadline = Date.now() + timeoutMs;
  let previousLogs = "";

  while (Date.now() < deadline) {
    const { stdout, stderr } = await runContainerCli(["logs", name]);
    const logs = `${stdout}${stderr}`;
    const newLogs = logs.startsWith(previousLogs)
      ? logs.slice(previousLogs.length)
      : logs;
    previousLogs = logs;

    for (const line of newLogs.split(/\r?\n/).filter(Boolean)) {
      console.log(`[e2e] ${line}`);
      if (line.includes("Daft poll failed:")) throw new Error(line);
      if (line.includes(marker)) return;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${marker} after ${timeoutMs}ms`);
};

const waitForFirstPoll = () => waitForLog(containerName, "Daft poll complete:");

let failure;
try {
  console.log(`Running acceptance poll from ${image} using ${containerCli}`);
  await runContainerCli(["network", "create", networkName]);
  await runContainerCli([
    "run",
    "--detach",
    "--init",
    "--name",
    fixtureContainerName,
    "--network",
    networkName,
    image,
    "node",
    "--input-type=module",
    "--eval",
    fixtureScript,
  ]);
  await waitForLog(fixtureContainerName, "fixture ready");
  await runContainerCli([
    "run",
    "--detach",
    "--init",
    "--name",
    containerName,
    "--network",
    networkName,
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
  await runContainerCli(["rm", "--force", fixtureContainerName]).catch(
    () => undefined,
  );
  await runContainerCli(["network", "rm", networkName]).catch(() => undefined);
  await rm(dataDirectory, { recursive: true, force: true });
}

if (failure !== undefined) throw failure;
