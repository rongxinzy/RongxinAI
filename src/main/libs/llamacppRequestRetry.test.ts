import { expect, test, vi } from 'vitest';

import { retryLlamaCppReadRequest } from './llamacppRequestRetry';

test('retries a transient llama.cpp request failure before succeeding', async () => {
  const request = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockResolvedValueOnce('ready');

  await expect(retryLlamaCppReadRequest(request, { attempts: 2, delayMs: 0 })).resolves.toBe(
    'ready',
  );
  expect(request).toHaveBeenCalledTimes(2);
});

test('returns the final network error after read retries are exhausted', async () => {
  const error = new TypeError('fetch failed');
  const request = vi.fn<() => Promise<string>>().mockRejectedValue(error);

  await expect(retryLlamaCppReadRequest(request, { attempts: 3, delayMs: 0 })).rejects.toBe(error);
  expect(request).toHaveBeenCalledTimes(3);
});

test('does not retry HTTP or validation errors', async () => {
  const error = new Error('llama.cpp /models failed: HTTP 404');
  const request = vi.fn<() => Promise<string>>().mockRejectedValue(error);

  await expect(retryLlamaCppReadRequest(request, { attempts: 3, delayMs: 0 })).rejects.toBe(error);
  expect(request).toHaveBeenCalledOnce();
});
