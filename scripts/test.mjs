import { readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const testDirectory = fileURLToPath(new URL("../test/", import.meta.url));
const outputDirectory = fileURLToPath(
  new URL("../.cache/test-bundle/", import.meta.url),
);

const testEntries = (await readdir(testDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
  .map((entry) => `${testDirectory}/${entry.name}`)
  .sort();

if (testEntries.length === 0) {
  throw new Error(`No test files found in ${testDirectory}`);
}

await rm(outputDirectory, { recursive: true, force: true });
await build({
  entryPoints: testEntries,
  outdir: outputDirectory,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  sourcemap: "inline",
  logLevel: "warning",
});

const compiledTests = testEntries.map((entry) =>
  `${outputDirectory}/${entry.slice(testDirectory.length, -3)}.js`,
);

const testProcess = spawn(process.execPath, ["--test", ...compiledTests], {
  stdio: "inherit",
});

await new Promise((resolve) => {
  testProcess.once("error", () => {
    process.exitCode = 1;
    resolve();
  });
  testProcess.once("exit", (code) => {
    process.exitCode = code ?? 1;
    resolve();
  });
});
