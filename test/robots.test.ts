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
