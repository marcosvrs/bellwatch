// @ts-check

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: "command",
  commandRunner: {
    command: "npm test",
  },
  coverageAnalysis: "off",
  mutate: [
    "src/config.ts",
    "src/daft/**/*.ts",
    "src/monitor.ts",
    "src/ntfy.ts",
  ],
  reporters: ["clear-text", "json"],
  jsonReporter: {
    fileName: "coverage/mutation.json",
  },
  thresholds: {
    high: 90,
    low: 90,
    break: 90,
  },
  concurrency: 2,
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
  ...(process.env.STRYKER_INCREMENTAL === "false"
    ? { incremental: false }
    : {
        incremental: true,
        incrementalFile: "coverage/mutation-incremental.json",
      }),
};

export default config;
