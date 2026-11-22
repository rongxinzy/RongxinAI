import { t } from '../i18n';
import { resolveAnySearchGateway } from './anysearchGatewayCredentials';

const MAX_RESPONSE_BYTES = 128 * 1024;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readResults(response: Response): Promise<unknown> {
  if (!response.body) throw new Error(t('webSearchInvalidResponse'));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error(t('webSearchInvalidResponse'));
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(t('webSearchInvalidResponse'));
    }
  } finally {
    await reader.cancel().catch((): void => {});
    reader.releaseLock();
  }
}

export async function searchAnySearchGateway(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
) {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  if (
    !normalizedQuery ||
    normalizedQuery.length > 500 ||
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > 20
  ) {
    throw new Error(t('webSearchInvalidInput'));
  }
  const timeout = AbortSignal.timeout(25_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  requestSignal.throwIfAborted();
  const gateway = resolveAnySearchGateway();
  if (!gateway) throw new Error(t('webSearchConnectionFailed'));
  const response = await fetch(`${gateway.url.replace(/\/+$/, '')}/v1/search`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${gateway.token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ query: normalizedQuery, max_results: maxResults }),
    signal: requestSignal,
  }).catch(() => {
    requestSignal.throwIfAborted();
    throw new Error(t('webSearchConnectionFailed'));
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(t('webSearchRequestFailed', { status: String(response.status) }));
  }

  const data = record(record(await readResults(response)).data);
  const rawResults = data.results;
  if (!Array.isArray(rawResults)) throw new Error(t('webSearchInvalidResponse'));
  const results = rawResults.slice(0, maxResults).flatMap(value => {
    const item = record(value);
    if (typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url)) return [];
    return [
      {
        title: typeof item.title === 'string' ? item.title.slice(0, 500) : item.url,
        url: item.url,
        snippet: String(item.snippet ?? item.content ?? '').slice(0, 4000),
      },
    ];
  });
  const metadata = record(data.metadata);
  return {
    query: normalizedQuery,
    results,
    total: typeof metadata.total_results === 'number' ? metadata.total_results : results.length,
    elapsed: typeof metadata.search_time_ms === 'number' ? metadata.search_time_ms : undefined,
  };
}
