import { afterEach, expect, test, vi } from 'vitest';
import { retrySessionBusy } from './modelPoolRetry';
import { ModelPoolErrorCode, ModelPoolRetryPolicy } from '../shared/modelPool/constants';

afterEach(() => vi.useRealTimers());
const busy = () =>
  Response.json(
    { error: { code: ModelPoolErrorCode.SessionBusy } },
    { status: 503, headers: { 'retry-after': '2' } },
  );
test('retries only session_busy, respects delay and returns the untouched success stream', async () => {
  vi.useFakeTimers();
  const success = new Response('data: [DONE]\n\n');
  const send = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(success);
  const pending = retrySessionBusy(send, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1999);
  expect(send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toBe(success);
  expect(send).toHaveBeenCalledTimes(2);
});
test('limits retries and does not retry generic errors or post-inference binding failures', async () => {
  vi.useFakeTimers();
  const send = vi.fn(async () => busy());
  const pending = retrySessionBusy(send, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(6000);
  expect((await pending).status).toBe(503);
  expect(send).toHaveBeenCalledTimes(ModelPoolRetryPolicy.MaximumRetries + 1);
  for (const response of [
    new Response('unavailable', { status: 503 }),
    Response.json({ error: { code: 'session_selection_failed' } }, { status: 503 }),
    new Response(null, { status: 429 }),
  ]) {
    const once = vi.fn(async () => response);
    expect((await retrySessionBusy(once, new AbortController().signal)).status).toBe(
      response.status,
    );
    expect(once).toHaveBeenCalledTimes(1);
  }
});
test('cancellation during backoff and before start never sends another request', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const send = vi.fn(async () => busy());
  const pending = retrySessionBusy(send, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(100);
  controller.abort();
  await rejected;
  await vi.advanceTimersByTimeAsync(5000);
  expect(send).toHaveBeenCalledTimes(1);
  await expect(retrySessionBusy(send, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(send).toHaveBeenCalledTimes(1);
});
