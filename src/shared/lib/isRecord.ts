/**
 * narrows an unknown value to a plain object record. Arrays and null are
 * excluded; class instances and other non-array objects pass.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
