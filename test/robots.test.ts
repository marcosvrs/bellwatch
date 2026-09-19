import assert from "node:assert/strict";
import test from "node:test";
import { isRobotsAllowed } from "../src/daft/robots.js";

const robots = [
  "# comments are ignored",
  "malformed directive",
  "Disallow: /before-agent",
  "User-agent: ExampleBot",
  "User-agent: AnotherBot",
  "Disallow: /private",
  "Allow: /private/public",
  "Disallow: /*?secret=",
  "Disallow: /tie",
  "Allow: /tie",
  "User-agent:",
  "",
  "User-agent: *",
  "Disallow: /robots-only",
  "Allow: /robots-only/public",
].join("\n");

test("matches robots wildcard, precedence, and end anchors", () => {
  assert.equal(
    isRobotsAllowed(robots, "https://www.daft.ie/private", "ExampleBot/1.0"),
    false,
  );
  assert.equal(
    isRobotsAllowed(
      robots,
      "https://www.daft.ie/robots-only",
      "ExampleBot/1.0",
    ),
    true,
  );
  assert.equal(
    isRobotsAllowed(
      robots,
      "https://www.daft.ie/private/public",
      "ExampleBot/1.0",
    ),
    true,
  );
  assert.equal(
    isRobotsAllowed(
      robots,
      "https://www.daft.ie/files/example.pdf",
      "ExampleBot/1.0",
    ),
    true,
  );
  assert.equal(
    isRobotsAllowed(
      robots,
      "https://www.daft.ie/files/example.pdf?download=1",
      "ExampleBot/1.0",
    ),
    true,
  );
  assert.equal(
    isRobotsAllowed(
      robots,
      "https://www.daft.ie/private?secret=1",
      "ExampleBot/1.0",
    ),
    false,
  );
  assert.equal(
    isRobotsAllowed(robots, "https://www.daft.ie/tie", "ExampleBot/1.0"),
    true,
  );
});

test("uses wildcard groups for other user agents and allows unmatched groups", () => {
  assert.equal(
    isRobotsAllowed(robots, "https://www.daft.ie/robots-only", "Browser/1.0"),
    false,
  );
  assert.equal(
    isRobotsAllowed(
      robots,
      "https://www.daft.ie/robots-only/public",
      "Browser/1.0",
    ),
    true,
  );
  assert.equal(
    isRobotsAllowed(robots, "https://www.daft.ie/private", "UnknownBot/1.0"),
    true,
  );
  assert.equal(isRobotsAllowed("", "https://www.daft.ie/anything"), true);
});
test("parses directive boundaries, inline comments, and anchored literals", () => {
  const rules = [
    "User-agent: ExactBot",
    "Disallow: /literal.+",
    "Allow: /literal.+/public",
    "Disallow: /exact$",
    "Allow:",
    "User-agent: SecondBot",
    "Disallow: /second",
    "",
    "User-agent: *",
    "Disallow: /wild",
    "Allow: /wild/public",
    "Disallow: :not-a-path",
    "Disallow: /commented # this is not part of the rule",
  ].join("\r\n");

  assert.equal(
    isRobotsAllowed(
      rules,
      "https://www.daft.ie/literal.+",
      "ExactBot/1.0",
    ),
    false,
  );
  assert.equal(
    isRobotsAllowed(
      rules,
      "https://www.daft.ie/literal.+/public",
      "ExactBot/1.0",
    ),
    true,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/exact", "ExactBot/1.0"),
    false,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/exact/more", "ExactBot/1.0"),
    true,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/commented", "UnknownBot/1.0"),
    false,
  );
  assert.equal(
    isRobotsAllowed(
      rules,
      "https://www.daft.ie/commented#fragment",
      "UnknownBot/1.0",
    ),
    false,
  );
});

test("selects specific agents by token prefix and falls back to wildcard", () => {
  const rules = [
    "User-agent: Bot",
    "Disallow: /specific",
    "User-agent: *",
    "Disallow: /wild",
  ].join("\n");

  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/specific", "Bot/1.0"),
    false,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/wild", "NotBot/1.0"),
    false,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/wild", "BotExtra/1.0"),
    true,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/wild", "*"),
    false,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/wild", "   "),
    false,
  );
});

test("defaults missing and empty user agents to the wildcard group", () => {
  const rules = [
    "User-agent: Stryker",
    "Disallow: /",
    "",
    "User-agent: *",
    "Allow: /",
  ].join("\n");
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/blocked"),
    true,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/blocked", ""),
    true,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/blocked", "/Stryker"),
    true,
  );
});

test("starts a new robots group after rules and ignores malformed directives", () => {
  const rules = [
    "User-agent: First",
    "Disallow: /first",
    "User-agent: Second",
    "Disallow: /second",
    ": missing field",
    "not a directive",
  ].join("\n");

  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/first", "First"),
    false,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/second", "Second"),
    false,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/second", "First"),
    true,
  );
});
test("distinguishes blank agents, trimmed directives, and unknown fields", () => {
  const rules = [
    " User-agent : Trimmed ",
    " Disallow : /trimmed ",
    "User-agent:",
    "Disallow: /blank",
    "Sitemap: /unknown",
  ].join("\n");

  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/trimmed", "Trimmed/1.0"),
    false,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/blank", "Stryker/1.0"),
    true,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/unknown", "Unknown/1.0"),
    true,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/blank", "   "),
    true,
  );
});

test("uses longest-match and allow-on-tie precedence", () => {
  const rules = [
    "User-agent: *",
    "Allow: /precedence/public",
    "Disallow: /precedence",
    "Disallow: /same",
    "Allow: /same",
    "Disallow: /short/path",
    "Allow: /short*",
  ].join("\n");

  assert.equal(
    isRobotsAllowed(
      rules,
      "https://www.daft.ie/precedence/public",
      "Browser/1.0",
    ),
    true,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/same", "Browser/1.0"),
    true,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/short/path", "Browser/1.0"),
    false,
  );
});

test("keeps whitespace-only separators and empty-agent groups isolated", () => {
  const rules = [
    "User-agent: First",
    "   ",
    "User-agent: Second",
    "Disallow: /second",
  ].join("\n");
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/second", "First/1.0"),
    true,
  );

  const emptyAgentRules = [
    "User-agent:",
    "Disallow: /empty",
  ].join("\n");
  assert.equal(
    isRobotsAllowed(
      emptyAgentRules,
      "https://www.daft.ie/empty",
      "Stryker/1.0",
    ),
    true,
  );
});

test("uses only recognized directives and handles wildcard length", () => {
  const rules = [
    "User-agent: Trimmed",
    "Sitemap: /unknown",
    "Disallow: /short",
    "Allow: /short****************path",
  ].join("\n");
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/unknown", "Trimmed/1.0"),
    true,
  );
  assert.equal(
    isRobotsAllowed(
      rules,
      "https://www.daft.ie/short/path",
      "Trimmed/1.0",
    ),
    true,
  );
  assert.equal(
    isRobotsAllowed(
      rules,
      "https://www.daft.ie/short/other",
      "  Trimmed/1.0",
    ),
    false,
  );
});

test("counts literal dollar signs only when they are not anchors", () => {
  const rules = [
    "User-agent: *",
    "Disallow: /dollar$token",
    "Allow: /dollar*token",
    "Disallow: /anchor$",
    "Allow: /anchor",
    "Allow: /same-length$",
    "Disallow: /same-length",
  ].join("\n");
  assert.equal(
    isRobotsAllowed(
      rules,
      "https://www.daft.ie/dollar$token",
      "Browser/1.0",
    ),
    false,
  );
  assert.equal(
    isRobotsAllowed(rules, "https://www.daft.ie/anchor", "Browser/1.0"),
    true,
  );
  assert.equal(
    isRobotsAllowed(
      rules,
      "https://www.daft.ie/same-length",
      "Browser/1.0",
    ),
    true,
  );
});
