const LEGACY_SQLITE_DATETIME_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?$/;

/**
 * SQLite `datetime('now')` writes UTC timestamps without a zone marker
 * ("YYYY-MM-DD HH:MM:SS"), which `Date`/`Date.parse` interpret as local time.
 * Normalize those to ISO UTC so display and sorting stay timezone-correct.
 * Values that already carry a zone designator pass through unchanged.
 */
export function normalizeMemoryTimestamp(value: string): string {
  const match = LEGACY_SQLITE_DATETIME_PATTERN.exec(value.trim());
  if (!match) return value;
  return `${match[1]}T${match[2]}${match[3] ?? ''}Z`;
}

/** Returns milliseconds since epoch, or NaN when the value is not parseable. */
export function parseMemoryTimestamp(value: string): number {
  return Date.parse(normalizeMemoryTimestamp(value));
}
