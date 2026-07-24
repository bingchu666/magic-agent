type PlainRow = Record<string, unknown>;

function isPlainRow(value: unknown): value is PlainRow {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toSnakeKey(key: string) {
  return key.replace(/([A-Z])/g, "_$1").toLowerCase();
}

function toCamelKey(key: string) {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** Convert a domain object to a shallow Postgres row without rewriting JSON values. */
export function toDatabaseRow<T extends PlainRow>(value: T): PlainRow {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, fieldValue]) => fieldValue !== undefined)
      .map(([key, fieldValue]) => [toSnakeKey(key), fieldValue])
  );
}

/** Convert one Postgres row to a domain object without rewriting nested JSON values. */
export function fromDatabaseRow<T>(value: unknown): T | null {
  if (!isPlainRow(value)) return null;
  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => [toCamelKey(key), fieldValue])
  ) as T;
}

export function fromDatabaseRows<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => fromDatabaseRow<T>(row))
    .filter((row): row is T => row !== null);
}
