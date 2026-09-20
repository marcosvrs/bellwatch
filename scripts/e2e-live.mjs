import { chmod, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const containerCli =
  process.env.CONTAINER_CLI?.trim() ||
  (process.platform === "darwin" ? "container" : "docker");
const image = process.env.E2E_IMAGE?.trim() || "bellwatch:e2e-live";
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS ?? "240000");
const webhookSecret = "bellwatch-live-e2e-secret";
const webhookChatId = "bellwatch-live-e2e";

if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  throw new Error(`E2E_TIMEOUT_MS must be a positive integer: ${timeoutMs}`);
}

const suffix = `${process.pid}-${Date.now()}`;
const containerName = `bellwatch-live-e2e-${suffix}`;
const sinkContainerName = `bellwatch-live-e2e-sink-${suffix}`;
const networkName = `bellwatch-live-e2e-network-${suffix}`;
const dataDirectory = await mkdtemp(join(tmpdir(), "bellwatch-live-e2e-"));
await chmod(dataDirectory, 0o777);

const environment = [
  [
    "HERMES_WEBHOOK_URL",
    `http://${sinkContainerName}:8080/webhooks/ha-notify`,
  ],
  ["HERMES_WEBHOOK_SECRET", webhookSecret],
  ["HERMES_CHAT_ID", webhookChatId],
  ["DAFT_BASE_URL", "https://www.daft.ie"],
  ["DAFT_SECTION_PATH", "property-for-rent"],
  ["DAFT_LOCATION", "dublin-city"],
  ["DAFT_MAX_PAGES", "1"],
  ["DAFT_REQUEST_DELAY_MS", "1000"],
  ["NOTIFY_EXISTING_ON_FIRST_RUN", "true"],
  ["POLL_CRON", "0 0 1 1 *"],
  ["TZ", "UTC"],
];

const sinkScript = `
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const secret = process.env.WEBHOOK_SECRET;
const expectedChatId = ${JSON.stringify(webhookChatId)};
if (!secret) throw new Error("WEBHOOK_SECRET is required");

const respond = (response, status, body) => {
  response.writeHead(status, { "content-type": "text/plain" });
  response.end(body);
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://live-e2e-sink:8080");
  if (url.pathname === "/health" && request.method === "GET") {
    respond(response, 200, "ok");
    return;
  }
  if (url.pathname !== "/webhooks/ha-notify" || request.method !== "POST") {
    respond(response, 404, "not found");
    return;
  }

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const timestamp = request.headers["x-webhook-timestamp"];
  const signature = request.headers["x-webhook-signature-v2"];
  const expected = createHmac("sha256", secret)
    .update(String(timestamp) + "." + body.toString("utf8"), "utf8")
    .digest("hex");
  const validSignature =
    typeof timestamp === "string" &&
    typeof signature === "string" &&
    /^[0-9a-f]{64}$/i.test(signature) &&
    timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  if (!validSignature) {
    respond(response, 401, "invalid signature");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    respond(response, 400, "invalid JSON");
    return;
  }
  if (
    payload?.chat_id !== expectedChatId ||
    typeof payload?.message !== "string" ||
    !payload.message.includes("\\nDaft: https://www.daft.ie/")
  ) {
    respond(response, 422, "invalid live Daft finding");
    return;
  }

  console.log("live notification received");
  respond(response, 204, "");
});
server.listen(8080, "0.0.0.0", () => console.log("live sink ready"));
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
      console.log(`[live-e2e] ${line}`);
      if (line.includes("Daft poll failed:")) throw new Error(line);
      if (line.includes(marker)) return line;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${marker} after ${timeoutMs}ms`);
};

const waitForLivePoll = async () => {
  const line = await waitForLog(containerName, "Daft poll complete:");
  const findings = Number(line.match(/findings=(\d+)/)?.[1] ?? "NaN");
  const notified = Number(line.match(/notified=(\d+)/)?.[1] ?? "NaN");
  if (!Number.isInteger(findings) || findings < 1) {
    throw new Error(`Live Daft poll returned no findings: ${line}`);
  }
  if (!Number.isInteger(notified) || notified < 1) {
    throw new Error(`Live Daft poll emitted no notification: ${line}`);
  }
  return line;
};

let failure;
try {
  console.log(`Running live Daft acceptance poll from ${image} using ${containerCli}`);
  await runContainerCli(["network", "create", networkName]);
  await runContainerCli([
    "run",
    "--detach",
    "--init",
    "--name",
    sinkContainerName,
    "--network",
    networkName,
    "--env",
    `WEBHOOK_SECRET=${webhookSecret}`,
    image,
    "node",
    "--input-type=module",
    "--eval",
    sinkScript,
  ]);
  await waitForLog(sinkContainerName, "live sink ready");
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
  await waitForLivePoll();
  await waitForLog(sinkContainerName, "live notification received");
  await runContainerCli(["exec", containerName, "node", "dist/healthcheck.js"]);
  console.log("Live Daft poll, signed notification, and production healthcheck passed");
} catch (error) {
  failure = error;
} finally {
  await runContainerCli(["rm", "--force", containerName]).catch(() => undefined);
  await runContainerCli(["rm", "--force", sinkContainerName]).catch(
    () => undefined,
  );
  await runContainerCli(["network", "rm", networkName]).catch(() => undefined);
  await rm(dataDirectory, { recursive: true, force: true });
}

if (failure !== undefined) throw failure;
