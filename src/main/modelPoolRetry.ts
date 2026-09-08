import { ModelPoolErrorCode, ModelPoolRetryPolicy } from '../shared/modelPool/constants';

export async function readModelPoolErrorBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  let bytes = 0;
  let text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return text + decoder.decode();
      bytes += result.value.byteLength;
      if (bytes > ModelPoolRetryPolicy.MaximumErrorBodyBytes) {
        await reader.cancel();
        return '';
      }
      text += decoder.decode(result.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

// Retry only a pre-inference session-lock rejection, never generic 503s or partial output.
export async function retrySessionBusy(
  send: () => Promise<Response>,
  signal: AbortSignal,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const response = await send();
    if (response.status !== 503 || attempt >= ModelPoolRetryPolicy.MaximumRetries) return response;
    const text = await readModelPoolErrorBody(response);
    const fallback = () =>
      new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    let code: unknown;
    try {
      const body: unknown = JSON.parse(text);
      if (body && typeof body === 'object' && 'error' in body) {
        const error = body.error;
        if (error && typeof error === 'object' && 'code' in error) code = error.code;
      }
    } catch {
      return fallback();
    }
    if (code !== ModelPoolErrorCode.SessionBusy) return fallback();
    const value = response.headers.get('retry-after');
    const seconds = value === null ? NaN : Number(value);
    const delay =
      Number.isFinite(seconds) && seconds >= 0
        ? seconds * 1000
        : ModelPoolRetryPolicy.DefaultDelayMs;
    // Do not retry earlier than the server asks; long waits remain explicit failures.
    if (delay > ModelPoolRetryPolicy.MaximumDelayMs) return fallback();
    await response.body?.cancel();
    await waitForRetry(delay, signal);
  }
}
