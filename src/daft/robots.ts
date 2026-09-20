interface RobotsRule {
  readonly allow: boolean;
  readonly pattern: string;
}

interface RobotsGroup {
  readonly agents: string[];
  readonly rules: RobotsRule[];
}

const escapeRegex = (value: string): string =>
  value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

const matchesRule = (pattern: string, path: string): boolean => {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const expression = body.split("*").map(escapeRegex).join(".*");
  return new RegExp(`^${expression}${anchored ? "$" : ""}`).test(path);
};

const parseRobots = (robotsText: string): RobotsGroup[] => {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | undefined;
  let sawRule: boolean | undefined;
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.split("#", 1).join().trim();
    if (!line) {
      current = undefined;
      continue;
    }
    const separator = line.indexOf(":");
    const field = line.slice(0, Math.max(separator, 0)).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || sawRule) {
        current = { agents: new Array<string>(), rules: [] };
        groups.push(current);
        sawRule = false;
      }
      if (value) {current.agents.push(value.toLowerCase());}
      continue;
    }
    if (
      current &&
      (field === "allow" || field === "disallow") &&
      value
    ) {
      current.rules.push({ allow: field === "allow", pattern: value });
      sawRule = true;
    }
  }

  return groups;
};

export const isRobotsAllowed = (
  robotsText: string,
  targetUrl: string,
  userAgent = "",
): boolean => {
  const target = new URL(targetUrl);
  const path = `${target.pathname}${target.search}`;
  const token = userAgent.trim().toLowerCase().match(/^[^\s/]+/)?.[0];
  const parsedGroups = parseRobots(robotsText);
  const specificGroups = parsedGroups.filter((group) =>
    group.agents.some(
      (agent) => token !== undefined && token.startsWith(agent),
    ),
  );
  const groups =
    specificGroups.length > 0
      ? specificGroups
      : parsedGroups.filter((group) => group.agents.includes("*"));
  let best: { allow: boolean; length: number } | undefined;

  for (const group of groups) {
    for (const rule of group.rules) {
      if (!matchesRule(rule.pattern, path)) {continue;}
      const length = rule.pattern.replaceAll("*", "").replace(/\$$/, "").length;
      if (!best || length > best.length || (length === best.length && rule.allow)) {
        best = { allow: rule.allow, length };
      }
    }
  }

  return best?.allow ?? true;
};
