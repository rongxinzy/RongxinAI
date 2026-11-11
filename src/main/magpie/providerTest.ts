import { extractRuntimeErrorMessage } from '../../shared/magpie/runtimeErrorMessage';
import type { MagpieProviderApi, MagpieTestProviderResult } from '../../shared/magpie/types';

const TEST_BODY_LIMIT_BYTES = 256 * 1024;

/** Reads at most `limit` bytes so a channel can't stream an unbounded page into main. */
async function readBoundedBody(
  response: Response,
  limit: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = limit - size;
      if (value.byteLength > room) {
        chunks.push(value.subarray(0, room));
        size = limit;
        truncated = true;
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed by the peer.
    }
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(merged), truncated };
}

export async function probeProviderEndpoint(
  baseUrl: string,
  api: MagpieProviderApi,
  key: string,
  fetchImpl: typeof fetch,
): Promise<MagpieTestProviderResult> {
  const start = Date.now();
  try {
    const url = baseUrl.replace(/\/+$/, '');
    const endpoint = api === 'anthropic-messages' ? `${url}/v1/messages` : `${url}/models`;
    const headers: Record<string, string> = {};
    if (key) {
      if (api === 'anthropic-messages') {
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['Authorization'] = `Bearer ${key}`;
      }
    }
    const res = await fetchImpl(endpoint, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const requiresKey = res.status === 401 || res.status === 403;
      return {
        ok: false,
        latencyMs,
        requiresKey,
        errorCode: 'http',
        error: requiresKey
          ? 'API Key is required or invalid (HTTP 401/403)'
          : `HTTP ${res.status}: ${res.statusText}`,
      };
    }
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    const body = await readBoundedBody(res, TEST_BODY_LIMIT_BYTES);
    const text = body.text.replace(/^\uFEFF/, '');
    const trimmed = text.trimStart();
    if (contentType.includes('text/html') || trimmed.startsWith('<')) {
      return {
        ok: false,
        latencyMs,
        errorCode: 'html-endpoint',
        error: 'The endpoint returned a web page, not a model API',
      };
    }
    // A cut body can't prove the list is JSON, and a success without models
    // would let a new provider be saved with an empty model list.
    if (body.truncated) {
      return {
        ok: false,
        latencyMs,
        errorCode: 'too-large',
        error: 'The model list exceeds 256 KiB; enter the model ids manually',
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        latencyMs,
        errorCode: 'not-json',
        error: 'The endpoint did not return JSON',
      };
    }
    let data: unknown[] | undefined;
    let hasErrorEnvelope = false;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if ('data' in parsed && Array.isArray(parsed.data)) data = parsed.data;
      hasErrorEnvelope = 'error' in parsed || 'message' in parsed;
    }
    if (!data && hasErrorEnvelope) {
      return {
        ok: false,
        latencyMs,
        errorCode: 'api-error',
        error: extractRuntimeErrorMessage(text),
      };
    }
    if (!data) return { ok: true, latencyMs };
    const discoveredModels = Array.from(
      new Set(
        data
          .map(item => {
            if (typeof item === 'string') return item.trim();
            if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
              return item.id.trim();
            }
            return '';
          })
          .filter(Boolean),
      ),
    );
    return { ok: true, latencyMs, modelCount: discoveredModels.length, discoveredModels };
  } catch (err: unknown) {
    return {
      ok: false,
      errorCode: 'network',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
