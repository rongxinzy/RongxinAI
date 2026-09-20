/** Dev-only: mirror main-process HTTP into renderer DevTools Network via xr-net:// beacons. */

export const DEV_NETWORK_SCHEME = 'xr-net';
export const DEV_NETWORK_BODY_MAX_CHARS = 16_000;

export type DevNetworkLogSource = 'api-fetch' | 'api-stream' | 'aisphere' | 'page';

export type DevNetworkLogEntry = {
  id: string;
  source: DevNetworkLogSource;
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  error?: string;
  requestBody?: string;
  responseBody?: string;
  startedAt: number;
};

const SENSITIVE_QUERY = /^(token|key|api[_-]?key|access[_-]?token|auth|password|secret)$/i;
const SENSITIVE_JSON_VALUE =
  /("(?:api[_-]?key|access[_-]?token|authorization|password|secret|token)"\s*:\s*")([^"]*)/gi;

/** Strip credentials from URLs before they leave the main process. */
export function sanitizeNetworkUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY.test(key)) url.searchParams.set(key, '***');
    }
    return url.toString();
  } catch {
    return raw.slice(0, 500);
  }
}

/** Truncate + light-redact bodies for Network Response preview (dev only). */
export function truncateNetworkBody(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text) return undefined;
  const redacted = text.replace(SENSITIVE_JSON_VALUE, '$1***');
  if (redacted.length <= DEV_NETWORK_BODY_MAX_CHARS) return redacted;
  return `${redacted.slice(0, DEV_NETWORK_BODY_MAX_CHARS)}\n…[truncated ${redacted.length} chars]`;
}

/** Page fetch to this URL appears in Chromium DevTools Network (dev only). */
export function buildDevNetworkBeaconUrl(entry: DevNetworkLogEntry): string {
  const params = new URLSearchParams({
    method: entry.method,
    status: String(entry.status ?? 0),
    ms: String(entry.durationMs ?? 0),
    source: entry.source,
    url: entry.url,
  });
  if (entry.error) params.set('error', entry.error.slice(0, 200));
  return `${DEV_NETWORK_SCHEME}://log/?${params.toString()}`;
}

/** JSON shown in DevTools Network → Response for the beacon request. */
export function buildDevNetworkBeaconPayload(entry: DevNetworkLogEntry): string {
  return JSON.stringify(
    {
      id: entry.id,
      source: entry.source,
      method: entry.method,
      url: entry.url,
      status: entry.status ?? 0,
      durationMs: entry.durationMs ?? 0,
      error: entry.error,
      requestBody: entry.requestBody,
      responseBody: entry.responseBody,
    },
    null,
    2,
  );
}
