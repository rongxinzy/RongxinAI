import { ZhiyuanModelPool } from '../../shared/modelPool/constants';

const PROBE_TIMEOUT_MS = 1500;
const PROBE_TTL_MS = 60_000;

interface IntranetProbeCache {
  available: boolean;
  checkedAt: number;
}

let probeCache: IntranetProbeCache | null = null;
let inFlightProbe: Promise<boolean> | null = null;

export function zhiyuanIntranetApiKey(): string {
  return Buffer.from(ZhiyuanModelPool.IntranetApiKeyBase64, 'base64').toString('utf8');
}

function parseModelIds(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const id = (item as Record<string, unknown>).id;
    return typeof id === 'string' && id.trim() ? [id.trim()] : [];
  });
}

async function probeIntranetModels(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${ZhiyuanModelPool.IntranetBaseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${zhiyuanIntranetApiKey()}` },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const modelIds = parseModelIds(await response.json());
    return modelIds.includes(ZhiyuanModelPool.IntranetModelId);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True when the office intranet gateway answers /v1/models and its catalog
 * contains the intranet model. Probed lazily with a short timeout and cached
 * briefly so session startup never pays the full timeout more than once a
 * minute.
 */
export async function probeZhiyuanIntranet(): Promise<boolean> {
  if (probeCache && Date.now() - probeCache.checkedAt < PROBE_TTL_MS) {
    return probeCache.available;
  }
  if (!inFlightProbe) {
    inFlightProbe = probeIntranetModels()
      .then(available => {
        probeCache = { available, checkedAt: Date.now() };
        return available;
      })
      .finally(() => {
        inFlightProbe = null;
      });
  }
  return inFlightProbe;
}

/** Fire-and-forget warmup so the first real request finds a warm cache. */
export function warmZhiyuanIntranetProbe(): void {
  void probeZhiyuanIntranet().catch((): void => undefined);
}

export function resetZhiyuanIntranetProbeForTests(): void {
  probeCache = null;
  inFlightProbe = null;
}
