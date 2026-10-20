const MAGPIE_NON_USABLE_PROVIDER_KEYS = new Set(['none', 'magpie-local']);

export function isUsableMagpieProviderKey(key: string | undefined): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  return trimmed.length > 0 && !MAGPIE_NON_USABLE_PROVIDER_KEYS.has(trimmed);
}

export function parseMagpieProviderKeyResponse(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const key = (body as Record<string, unknown>).key;
  return typeof key === 'string' ? key : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Upstream masks keys of length ≤8 as bullets; legacy placeholder `none` looks like `••••`. */
export function providerRowNeedsStoredKeyLookup(row: Record<string, unknown>): boolean {
  const key = row.key;
  if (typeof key === 'string') {
    return key.length > 0 && key !== 'magpie-local';
  }
  if (!isRecord(key) || key.set !== true) return false;
  const masked = key.masked;
  if (typeof masked === 'string' && /^•+$/.test(masked)) return true;
  return false;
}
