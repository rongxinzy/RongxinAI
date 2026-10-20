import type { MagpieProviderSummary } from '../../shared/magpie/types';

const MAGPIE_NON_USABLE_PROVIDER_KEYS = new Set(['none', 'magpie-local']);

export const MAGPIE_STORED_KEY_PROBE_CONCURRENCY = 4;

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
  if (!isRecord(key) || key.set !== true) return false;
  const masked = key.masked;
  return typeof masked === 'string' && /^•+$/.test(masked);
}

function applyStoredKeyToSummary(summary: MagpieProviderSummary, stored: string | undefined): void {
  summary.hasKey = isUsableMagpieProviderKey(stored);
  if (!summary.hasKey) summary.keyMasked = undefined;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

/** Resolve bullet-masked rows via upstream `/api/provider/key` without failing the whole list. */
export async function enrichMagpieProviderSummariesWithStoredKeys(
  list: MagpieProviderSummary[],
  rawList: unknown[],
  fetchStoredKey: (id: string) => Promise<string | undefined>,
  concurrency = MAGPIE_STORED_KEY_PROBE_CONCURRENCY,
): Promise<void> {
  const rows = rawList.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === 'object' && !Array.isArray(row),
  );
  const jobs = list.flatMap(summary => {
    if (summary.isHostManaged) return [];
    const row = rows.find(entry => entry.id === summary.id);
    if (!row || !providerRowNeedsStoredKeyLookup(row)) return [];
    return [summary];
  });
  await mapWithConcurrency(jobs, concurrency, async summary => {
    try {
      const stored = await fetchStoredKey(summary.id);
      applyStoredKeyToSummary(summary, stored);
    } catch {
      /* keep projected summary when a single probe fails */
    }
  });
}
