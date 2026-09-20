export type JsonRecord = Record<string, unknown>;

const isJsonRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const asJsonRecord = (value: unknown): JsonRecord | undefined =>
  isJsonRecord(value) ? value : undefined;
