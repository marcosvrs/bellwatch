export interface DaftFinding {
  readonly id: string;
  readonly title: string;
  readonly developmentTitle: string;
  readonly priceText: string;
  readonly bedrooms?: number;
  readonly bathrooms?: number;
  readonly propertyType?: string;
  readonly url: string;
}

interface DaftPageResult {
  readonly findings: readonly DaftFinding[];
  readonly currentPage: number;
  readonly totalPages: number;
}

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;

const stringValue = (record: JsonRecord | undefined, key: string): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const numberValue = (record: JsonRecord | undefined, key: string): number | undefined => {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
};

const parseCount = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : undefined;
};

const absoluteUrl = (baseUrl: string, path: string | undefined, id: string): string => {
  const fallback = `/new-home-for-sale/listing/${id}`;
  return new URL(path ?? fallback, baseUrl).toString();
};

const unitTitle = (
  developmentTitle: string,
  unit: JsonRecord,
): string => {
  const details = [
    stringValue(unit, "numBedrooms"),
    stringValue(unit, "numBathrooms"),
    stringValue(unit, "propertyType"),
  ].filter(Boolean);
  return details.length > 0
    ? `${developmentTitle} — ${details.join(" · ")}`
    : developmentTitle;
};

const parseListing = (
  value: unknown,
  baseUrl: string,
): DaftFinding[] => {
  const wrapper = asRecord(value);
  const listing = asRecord(wrapper?.listing);
  if (!listing) return [];

  const parentId = numberValue(listing, "id");
  const parentIdText = parentId === undefined ? undefined : String(parentId);
  if (!parentIdText) return [];

  const newHome = asRecord(listing.newHome);
  const developmentTitle =
    stringValue(newHome, "developmentName") ??
    stringValue(listing, "title") ??
    `Daft development ${parentIdText}`;
  const units = Array.isArray(newHome?.subUnits)
    ? newHome.subUnits.map(asRecord).filter((unit): unit is JsonRecord => unit !== undefined)
    : [];

  if (units.length === 0) {
    const path = stringValue(listing, "seoFriendlyPath");
    const priceText = stringValue(listing, "price") ?? "Price unavailable";
    return [
      {
        id: parentIdText,
        title: developmentTitle,
        developmentTitle,
        priceText,
        bedrooms: parseCount(stringValue(listing, "numBedrooms")),
        propertyType: stringValue(listing, "propertyType"),
        url: absoluteUrl(baseUrl, path, parentIdText),
      },
    ];
  }

  return units.flatMap((unit) => {
    const id = numberValue(unit, "id");
    if (id === undefined) return [];
    const idText = String(id);
    const priceText = stringValue(unit, "price") ?? "Price unavailable";
    return [
      {
        id: idText,
        title: unitTitle(developmentTitle, unit),
        developmentTitle,
        priceText,
        bedrooms: parseCount(stringValue(unit, "numBedrooms")),
        bathrooms: parseCount(stringValue(unit, "numBathrooms")),
        propertyType: stringValue(unit, "propertyType"),
        url: absoluteUrl(
          baseUrl,
          stringValue(unit, "seoFriendlyPath"),
          idText,
        ),
      },
    ];
  });
};

export const parseDaftPage = (
  payload: unknown,
  baseUrl: string,
): DaftPageResult => {
  const root = asRecord(payload);
  const props = asRecord(root?.props);
  const pageProps = asRecord(props?.pageProps) ?? root ?? {};
  const listings = Array.isArray(pageProps.listings) ? pageProps.listings : [];
  const seen = new Set<string>();
  const findings: DaftFinding[] = [];
  for (const listing of listings) {
    for (const finding of parseListing(listing, baseUrl)) {
      if (seen.has(finding.id)) continue;
      seen.add(finding.id);
      findings.push(finding);
    }
  }

  const paging = asRecord(pageProps.paging);
  const currentPage = numberValue(paging, "currentPage") ?? 1;
  const totalPages = numberValue(paging, "totalPages") ?? currentPage;
  return {
    findings,
    currentPage,
    totalPages,
  };
};
