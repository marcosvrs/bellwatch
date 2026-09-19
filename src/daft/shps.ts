import type { DaftFinding } from "./parser.js";

export const SHPS_FILTER_MODES = ["off", "only", "exclude"] as const;
export type ShpsFilterMode = (typeof SHPS_FILTER_MODES)[number];

export interface ShpsConfig {
  readonly filter: ShpsFilterMode;
}

export type ShpsAvailability =
  | "shps-only"
  | "shps-and-other"
  | "not-shps"
  | "unknown";

const SHPS_MARKERS = [
  "starter home purchase scheme",
  "starter homes programme",
  "starter home programme",
  "local authority affordable purchase scheme",
  "local authority affordable purchase",
  "affordable dwelling purchase arrangement",
  "affordable purchase scheme",
] as const;

const OTHER_SCHEME_MARKERS = [
  "help to buy",
  "htb",
  "first home scheme",
  "cost rental",
] as const;

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ");

const hasShpsMarker = (value: string): boolean => {
  const normalized = normalizeText(value);
  return (
    /(?:^| )(?:shps|laaps)(?: |$)/.test(normalized) ||
    SHPS_MARKERS.some((marker) => normalized.includes(marker))
  );
};

const sentences = (value: string): readonly string[] =>
  value.split(/[\r\n]|(?<=[.!?])\s/);

const isOptionalHelpToBuyFunding = (sentence: string): boolean => {
  const normalized = normalizeText(sentence);
  return (
    /\b(?:help to buy|htb)\b/.test(normalized) &&
    /\b(?:mortgage|savings|deposit|minimum (?:sale|purchase) price|purchase price|upfront cost|funding|afford)\b/.test(
      normalized,
    ) &&
    /\b(?:if eligible|where eligible|possibly|subject to eligibility|may be used)\b/.test(
      normalized,
    )
  );
};

const hasOtherSchemeAvailability = (value: string): boolean => {
  const normalized = normalizeText(value);
  const parts = sentences(value);

  if (
    parts.some(
      (sentence) =>
        /\b(?:help to buy|htb)\b/.test(normalizeText(sentence)) &&
        !isOptionalHelpToBuyFunding(sentence),
    )
  ) {
    return true;
  }

  return OTHER_SCHEME_MARKERS.some(
    (marker) =>
      marker !== "help to buy" &&
      marker !== "htb" &&
      normalized.includes(marker),
  );
};

const SCHEME_PHRASE =
  /\b(?:[a-z0-9]+ ){0,3}schemes?\b(?: of priority)?/g;

const KNOWN_SCHEME_SUFFIX =
  /(?:starter home purchase scheme|starter homes programme|starter home programme|local authority affordable purchase scheme|local authority affordable purchase|affordable dwelling purchase arrangement|affordable purchase scheme|help to buy|htb|first home scheme|cost rental)(?: scheme| schemes|)/;

const isKnownSchemePhrase = (phrase: string): boolean =>
  KNOWN_SCHEME_SUFFIX.test(phrase) ||
  /\b(?:the|this|that|our|your|a|an) schemes?\b/.test(phrase) ||
  /scheme of priority/.test(phrase);

const hasUnrecognisedSchemeAvailability = (value: string): boolean =>
  Array.from(normalizeText(value).matchAll(SCHEME_PHRASE)).some(
    ([phrase]) => !isKnownSchemePhrase(phrase),
  );

export const classifyShpsAvailability = (
  finding: DaftFinding,
): ShpsAvailability => {
  const text = [finding.title, finding.developmentTitle, finding.schemeText].join(
    "\n",
  );
  if (!hasShpsMarker(text)) {return "not-shps";}
  if (!finding.schemeText?.trim()) {return "unknown";}
  if (hasOtherSchemeAvailability(text)) {return "shps-and-other";}
  if (hasUnrecognisedSchemeAvailability(text)) {return "shps-and-other";}
  return "shps-only";
};

export const isShpsOnlyFinding = (finding: DaftFinding): boolean =>
  classifyShpsAvailability(finding) === "shps-only";

export const filterShpsFindings = (
  findings: readonly DaftFinding[],
  config: ShpsConfig,
): readonly DaftFinding[] => {
  switch (config.filter) {
    case "off":
      return findings;
    case "only":
      return findings.filter(isShpsOnlyFinding);
    case "exclude":
      return findings.filter((finding) => !isShpsOnlyFinding(finding));
  }
};
