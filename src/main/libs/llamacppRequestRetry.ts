const DEFAULT_ATTEMPTS = 4;
const DEFAULT_DELAY_MS = 250;

type RetryOptions = {
  attempts?: number;
  delayMs?: number;
};

/** Retries only idempotent llama.cpp read requests after transient network failures. */
export async function retryLlamaCppReadRequest<T>(
  request: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? DEFAULT_ATTEMPTS));
  const delayMs = Math.max(0, options.delayMs ?? DEFAULT_DELAY_MS);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isRetryableReadError(error)) break;
      if (delayMs > 0) {
        await new Promise<void>(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

function isRetryableReadError(error: unknown): boolean {
  return error instanceof TypeError || (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}
