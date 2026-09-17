#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import strykerConfig from "../stryker.config.mjs";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const ZERO_SHA = /^0{40}$/;
const coverageConfig = JSON.parse(
  readFileSync(new URL("../.c8rc.json", import.meta.url), "utf8"),
);
const coverageExcluded = new Set(coverageConfig.exclude ?? []);
const mutationPatterns = strykerConfig.mutate ?? [];
const validationConfigFiles = new Set([
  ".c8rc.json",
  "alchemy.run.ts",
  "package-lock.json",
  "package.json",
  "stryker.config.mjs",
  "tsconfig.alchemy.json",
  "tsconfig.json",
  "tsconfig.test.json",
]);

const run = (command, args, environment = process.env) => {
  const result = spawnSync(command, args, {
    env: environment,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const capture = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${command} ${args.join(" ")} failed`);
  }

  return result.stdout.trim();
};

const readHookInput = async () => {
  if (process.stdin.isTTY) return "";

  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input;
};

const parsePushRanges = (input) =>
  input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 4)
    .map(([, localSha, , remoteSha]) => ({
      base: remoteSha,
      head: localSha,
    }))
    .filter(({ head }) => !ZERO_SHA.test(head));

const resolveRanges = async () => {
  const [baseArgument, headArgument] = process.argv.slice(2);
  if (baseArgument !== undefined || headArgument !== undefined) {
    return [
      {
        base: baseArgument || undefined,
        head: headArgument || "HEAD",
      },
    ];
  }

  const hookRanges = parsePushRanges(await readHookInput());
  if (hookRanges.length > 0) return hookRanges;

  return [{ base: capture("git", ["rev-parse", "HEAD^"]), head: "HEAD" }];
};

const resolveBase = (base) => {
  if (base === undefined) return capture("git", ["rev-parse", "HEAD^"]);
  if (ZERO_SHA.test(base)) return EMPTY_TREE;
  return base;
};

const changedFilesFor = ({ base, head }) => {
  const resolvedHead = ZERO_SHA.test(head) ? undefined : head;
  if (resolvedHead === undefined) return [];

  return capture("git", [
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
    resolveBase(base),
    resolvedHead,
  ])
    .split(/\r?\n/)
    .map((file) => file.trim().replaceAll("\\", "/"))
    .filter(Boolean);
};
const changedLineRangesFor = ({ base, head }) => {
  const resolvedHead = ZERO_SHA.test(head) ? undefined : head;
  if (resolvedHead === undefined) return [];

  let currentFile;
  return capture("git", [
    "diff",
    "--unified=0",
    "--diff-filter=ACMR",
    resolveBase(base),
    resolvedHead,
  ])
    .split(/\r?\n/)
    .flatMap((line) => {
      if (line.startsWith("+++ b/")) {
        currentFile = line.slice("+++ b/".length);
        return [];
      }

      const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (match === null || currentFile === undefined) return [];

      const start = Number(match[1]);
      const count = Number(match[2] ?? 1);
      return count === 0
        ? []
        : [{ file: currentFile, start, end: start + count - 1 }];
    });
};

const mergeRanges = (ranges) => {
  const byFile = new Map();
  for (const range of ranges) {
    const fileRanges = byFile.get(range.file) ?? [];
    fileRanges.push(range);
    byFile.set(range.file, fileRanges);
  }

  return [...byFile.entries()].flatMap(([file, fileRanges]) => {
    const merged = [];
    for (const range of fileRanges.sort(
      (left, right) => left.start - right.start,
    )) {
      const previous = merged.at(-1);
      if (previous !== undefined && range.start <= previous.end + 1) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        merged.push({ file, start: range.start, end: range.end });
      }
    }
    return merged;
  });
};

const mutationArgumentFor = ({ file, start, end }) =>
  `${file}:${start}-${end}`;

const matchesMutationPattern = (file) =>
  mutationPatterns.some((pattern) => {
    if (pattern === file) return true;
    if (!pattern.endsWith("/**/*.ts")) return false;

    const directory = pattern.slice(0, -"**/*.ts".length);
    return file.startsWith(directory) && file.endsWith(".ts");
  });

const main = async () => {
  const ranges = await resolveRanges();
  const changedFiles = [
    ...new Set(ranges.flatMap((range) => changedFilesFor(range))),
  ];
  const changedSources = changedFiles.filter(
    (file) =>
      file.startsWith("src/") && file.endsWith(".ts") && existsSync(file),
  );
  const coverageFiles = changedSources.filter(
    (file) => !coverageExcluded.has(file),
  );
  const mutationRanges = mergeRanges(
    ranges
      .flatMap((range) => changedLineRangesFor(range))
      .filter(({ file }) => matchesMutationPattern(file) && existsSync(file)),
  );
  const needsValidation = changedFiles.some(
    (file) =>
      file.startsWith("scripts/") ||
      file.startsWith("src/") ||
      file.startsWith("test/") ||
      validationConfigFiles.has(file),
  );
  if (!needsValidation) {
    console.log(
      "No code, test, or validation-config changes; skipping validation.",
    );
    return;
  }

  console.log(
    `Changed files: ${changedFiles.length}; changed TypeScript sources: ${changedSources.length}`,
  );
  if (coverageFiles.length > 0) {
    console.log(`Coverage files: ${coverageFiles.join(", ")}`);
  } else {
    console.log("No changed coverage targets; running tests without coverage.");
  }
  if (mutationRanges.length > 0) {
    console.log(
      `Mutation ranges: ${mutationRanges.map(mutationArgumentFor).join(", ")}`,
    );
  } else {
    console.log("No changed mutation lines; skipping mutation testing.");
  }

  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "build"]);

  if (coverageFiles.length === 0) {
    run("npm", ["test"]);
  } else {
    const coverageArguments = [
      "--all",
      "--check-coverage",
      "--statements",
      String(coverageConfig.statements ?? 100),
      "--functions",
      String(coverageConfig.functions ?? 100),
      "--reporter",
      "text",
      "--reporter",
      "lcov",
      ...coverageFiles.flatMap((file) => ["--include", file]),
      "npm",
      "test",
    ];
    run("c8", coverageArguments);
  }

  if (mutationRanges.length > 0) {
    run(
      "stryker",
      ["run", "--mutate", mutationRanges.map(mutationArgumentFor).join(",")],
      { ...process.env, STRYKER_INCREMENTAL: "false" },
    );
  }
};

await main();
