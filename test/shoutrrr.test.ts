import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import {
  ShoutrrrError,
  formatFindingMessage,
  publishFinding,
  type ShoutrrrRunner,
} from "../src/shoutrrr.js";

const finding = {
  id: "101",
  title: "Example Development — 3 Bed · 2 Bath · Terrace",
  developmentTitle: "Example Development",
  priceText: "€315,000",
  bedrooms: 3,
  bathrooms: 2,
  propertyType: "Terrace",
  schemeText: "Private address details must remain in process memory",
  url: "https://www.daft.ie/new-home-for-sale/example/101",
};

const config = {
  url: "ntfy://ntfy.sh/daft?priority=5&tags=house,new-home",
  binary: "shoutrrr",
  titlePrefix: "Bellwatch new home",
  timeoutMs: 5000,
};

const createExecutable = async (body: string) => {
  const directory = await mkdtemp(join(tmpdir(), "bellwatch-shoutrrr-"));
  const binary = join(directory, "shoutrrr");
  await writeFile(binary, `#!/usr/bin/env node\n${body}\n`);
  await chmod(binary, 0o755);
  return {
    binary,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
};

test("publishes a Shoutrrr message with its title and URL", async () => {
  let invocation:
    | {
        binary: string;
        args: readonly string[];
        message: string;
        timeoutMs: number;
      }
    | undefined;
  const run: ShoutrrrRunner = async (binary, args, message, timeoutMs) => {
    invocation = { binary, args, message, timeoutMs };
  };

  await Effect.runPromise(publishFinding(config, finding, run));

  assert.deepEqual(invocation, {
    binary: "shoutrrr",
    args: [
      "send",
      "--url",
      config.url,
      "--message",
      "-",
      "--title",
      "Bellwatch new home: Example Development — 3 Bed · 2 Bath · Terrace",
    ],
    message: [
      finding.title,
      "Price: €315,000",
      "Beds: 3",
      "Baths: 2",
      "Type: Terrace",
      "Development: Example Development",
      `Daft: ${finding.url}`,
    ].join("\n"),
    timeoutMs: 5000,
  });
  assert.equal(invocation?.message.includes("Private address details"), false);
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

test("includes the sold comparable range and market check", () => {
  const message = formatFindingMessage({
    ...finding,
    soldComparison: {
      year: 2026,
      comparableCount: 2,
      minPriceEur: 400000,
      maxPriceEur: 450000,
      askingPriceEur: 500000,
      verdict: "above",
    },
  });

  assert.equal(
    message,
    [
      finding.title,
      "Price: €315,000",
      "Beds: 3",
      "Baths: 2",
      "Type: Terrace",
      "Development: Example Development",
      "Sold comparables 2026: €400,000–€450,000 (2 sales)",
      "Market check: potentially overpriced (asking price above comparable sold range)",
      `Daft: ${finding.url}`,
    ].join("\n"),
  );
});

test("formats every sold comparison verdict and missing-range state", () => {
  const messages = new Map([
    ["within", "Market check: within comparable sold range"],
    ["below", "Market check: below comparable sold range"],
    ["unavailable", "Market check: asking price unavailable for comparison"],
  ]);
  for (const [verdict, line] of messages) {
    const message = formatFindingMessage({
      ...finding,
      soldComparison: {
        year: 2026,
        comparableCount: 1,
        minPriceEur: 400_000,
        maxPriceEur: 450_000,
        verdict: verdict as "within" | "below" | "unavailable",
      },
    });
    assert.equal(message.includes(line), true);
  }

  const noRange = formatFindingMessage({
    ...finding,
    soldComparison: {
      year: 2026,
      comparableCount: 0,
      verdict: "unavailable",
    },
  });
  assert.equal(noRange.includes("Sold comparables 2026: no matching sales"), true);
  assert.equal(
    noRange.includes("Market check: asking price unavailable for comparison"),
    true,
  );

  const missingVerdict = formatFindingMessage({
    ...finding,
    soldComparison: {
      year: 2026,
      comparableCount: 1,
      minPriceEur: 400_000,
    },
  });
  assert.equal(missingVerdict.includes("no matching sales"), true);
  assert.equal(missingVerdict.includes("Market check:"), false);
});

test("omits incomplete sold ranges and missing verdict lines", () => {
  const incompleteRange = formatFindingMessage({
    ...finding,
    soldComparison: {
      year: 2026,
      comparableCount: 1,
      maxPriceEur: 450_000,
      verdict: "unavailable",
    },
  });
  assert.equal(incompleteRange.includes("no matching sales"), true);

  const missingVerdict = formatFindingMessage({
    ...finding,
    soldComparison: {
      year: 2026,
      comparableCount: 1,
      minPriceEur: 400_000,
      maxPriceEur: 450_000,
    },
  });
  assert.equal(
    missingVerdict,
    [
      finding.title,
      "Price: €315,000",
      "Beds: 3",
      "Baths: 2",
      "Type: Terrace",
      "Development: Example Development",
      "Sold comparables 2026: €400,000–€450,000 (1 sales)",
      `Daft: ${finding.url}`,
    ].join("\n"),
  );
});

test("streams the message to the Shoutrrr CLI", async () => {
  const executable = await createExecutable(`
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  if (!process.argv.includes("--url")) process.exit(2);
  if (!chunks.join("").includes("Example Development")) process.exit(3);
});
`);
  try {
    await Effect.runPromise(
      publishFinding({ ...config, binary: executable.binary }, finding),
    );
  } finally {
    await executable.cleanup();
  }
});

test("reports a missing Shoutrrr executable", async () => {
  await assert.rejects(
    Effect.runPromise(
      publishFinding(
        { ...config, binary: "/path/that/does/not/exist/shoutrrr" },
        finding,
      ),
    ),
    (error: unknown) => {
      assert.match(String(error), /Could not start Shoutrrr notification/);
      assert.equal((error as Error).cause instanceof Error, true);
      return true;
    },
  );
});

test("does not buffer Shoutrrr stdout", async () => {
  const executable = await createExecutable(`
process.stdout.write("x".repeat(1024 * 1024), () => process.exit(0));
`);
  try {
    await Effect.runPromise(
      publishFinding(
        { ...config, binary: executable.binary, timeoutMs: 500 },
        finding,
      ),
    );
  } finally {
    await executable.cleanup();
  }
});


test("wraps a notification runner failure as a Shoutrrr error", async () => {
  await assert.rejects(
    Effect.runPromise(
      publishFinding(config, finding, async () => {
        throw new Error("network down");
      }),
    ),
    (error: unknown) => {
      assert.match(String(error), /Could not publish Shoutrrr notification/);
      const cause = (error as Error).cause;
      assert.equal(cause instanceof Error, true);
      assert.equal((cause as Error).message, "network down");
      return true;
    },
  );
});

test("reports a non-zero Shoutrrr process with trimmed stderr", async () => {
  const executable = await createExecutable(`
process.stderr.write("provider unavailable   ");
process.exit(2);
`);
  try {
    await assert.rejects(
      Effect.runPromise(
        publishFinding({ ...config, binary: executable.binary }, finding),
      ),
      (error: unknown) => {
        assert.equal(
          (error as Error).message,
          "Shoutrrr exited with code 2: provider unavailable",
        );
        return true;
      },
    );
  } finally {
    await executable.cleanup();
  }
});

test("limits captured Shoutrrr stderr", async () => {
  const executable = await createExecutable(`
process.stderr.write("x".repeat(500) + "overflow");
process.exit(2);
`);
  try {
    await assert.rejects(
      Effect.runPromise(
        publishFinding({ ...config, binary: executable.binary }, finding),
      ),
      new RegExp(`Shoutrrr exited with code 2: ${"x".repeat(500)}$`),
    );
  } finally {
    await executable.cleanup();
  }
});

test("reports a Shoutrrr process terminated by signal", async () => {
  const executable = await createExecutable(`
process.kill(process.pid, "SIGTERM");
`);
  try {
    await assert.rejects(
      Effect.runPromise(
        publishFinding({ ...config, binary: executable.binary }, finding),
      ),
      /Shoutrrr exited with signal SIGTERM/,
    );
  } finally {
    await executable.cleanup();
  }
});

test("omits stderr details when a Shoutrrr process has none", async () => {
  const executable = await createExecutable(`
process.exit(2);
`);
  try {
    await assert.rejects(
      Effect.runPromise(
        publishFinding({ ...config, binary: executable.binary }, finding),
      ),
      /Shoutrrr exited with code 2$/,
    );
  } finally {
    await executable.cleanup();
  }
});

test("exposes a tagged Shoutrrr error", () => {
  const error = new ShoutrrrError("bad");
  assert.equal(error.name, "ShoutrrrError");
  assert.equal(error._tag, "ShoutrrrError");
});

// This integration test must exercise the real child-process timeout and kill path.
test("times out a stalled Shoutrrr process", async () => {
  const executable = await createExecutable(`
process.stdin.resume();
setTimeout(() => {}, 1000);
`);
  try {
    await assert.rejects(
      Effect.runPromise(
        publishFinding(
          { ...config, binary: executable.binary, timeoutMs: 25 },
          finding,
        ),
      ),
      /Shoutrrr timed out after 25 milliseconds/,
    );
  } finally {
    await executable.cleanup();
  }
});
