type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merge fixture overrides onto the generated surface. Functions replace wholesale. */
export function applyOverrides<T>(base: T, overrides: DeepPartial<T> | undefined): T {
  if (overrides === undefined) return base;
  if (typeof overrides === 'function' || !isRecord(overrides) || !isRecord(base)) {
    return overrides as T;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overrides)) {
    const overrideValue = overrides[key];
    const baseValue = merged[key];
    if (typeof overrideValue === 'function' || !isRecord(overrideValue) || !isRecord(baseValue)) {
      merged[key] = overrideValue;
    } else {
      merged[key] = applyOverrides(baseValue, overrideValue);
    }
  }
  return merged as T;
}
