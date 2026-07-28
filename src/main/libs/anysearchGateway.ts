import {
  resolveAnySearchGatewayToken,
  resolveAnySearchGatewayUrl,
} from './anysearchGatewayCredentials';

export interface AnySearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
}

export interface AnySearchResponse {
  query: string;
  results: AnySearchResult[];
}

/** Main-process-only bridge to the product search gateway. */
export async function searchAnySearchGateway(
  input: {
    query?: unknown;
    maxResults?: unknown;
  },
  externalSignal?: AbortSignal,
): Promise<AnySearchResponse> {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query || query.length > 500)
    throw new Error('Search query must be between 1 and 500 characters.');
  const requested = typeof input.maxResults === 'number' ? input.maxResults : 8;
  const maxResults = Math.max(1, Math.min(10, Math.floor(requested)));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${resolveAnySearchGatewayUrl().replace(/\/+$/, '')}/v1/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolveAnySearchGatewayToken()}`,
      },
      body: JSON.stringify({ query, max_results: maxResults }),
      signal: externalSignal
        ? AbortSignal.any([controller.signal, externalSignal])
        : controller.signal,
    });
    if (!response.ok) throw new Error(`Search gateway request failed (${response.status}).`);
    const payload = (await response.json()) as unknown;
    const envelope =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const data =
      envelope.data && typeof envelope.data === 'object'
        ? (envelope.data as Record<string, unknown>)
        : {};
    const rawResults = Array.isArray(data.results)
      ? data.results
      : Array.isArray(envelope.results)
        ? envelope.results
        : [];
    const results = rawResults.slice(0, maxResults).flatMap((item): AnySearchResult[] => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Record<string, unknown>;
      const url = typeof value.url === 'string' ? value.url : '';
      if (!url) return [];
      return [
        {
          title: typeof value.title === 'string' ? value.title : url,
          url,
          snippet: typeof value.snippet === 'string' ? value.snippet : '',
          ...(typeof value.content === 'string' ? { content: value.content } : {}),
        },
      ];
    });
    return { query, results };
  } finally {
    clearTimeout(timeout);
  }
}
