import { expect, test, vi } from 'vitest';
import { buildProjectMemoryContextSafe, type ProjectMemoryService } from './projectMemoryService';
import { MEMORY_PROMPT_RECALL_TIMEOUT_MS } from './constants';

test('optional recall releases the request and cancels retrieval at the total deadline', async () => {
  vi.useFakeTimers();
  try {
    let signal: AbortSignal | undefined;
    const service = {
      buildProjectContext: vi.fn((input: { signal: AbortSignal }) => {
        signal = input.signal;
        return new Promise<string>(() => {});
      }),
    };
    const recalled = buildProjectMemoryContextSafe(
      service as unknown as ProjectMemoryService,
      '/work',
      's',
      'q',
    );
    await vi.advanceTimersByTimeAsync(MEMORY_PROMPT_RECALL_TIMEOUT_MS);
    await expect(recalled).resolves.toBe('');
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test('cancelled requests do not start memory retrieval', async () => {
  const controller = new AbortController();
  controller.abort();
  const service = { buildProjectContext: vi.fn() };
  await expect(
    buildProjectMemoryContextSafe(
      service as unknown as ProjectMemoryService,
      '/work',
      's',
      'q',
      controller.signal,
    ),
  ).resolves.toBe('');
  expect(service.buildProjectContext).not.toHaveBeenCalled();
});

test('cancellation releases a pending recall without waiting for the backend', async () => {
  const controller = new AbortController();
  const service = { buildProjectContext: () => new Promise<string>(() => {}) };
  const result = buildProjectMemoryContextSafe(
    service as unknown as ProjectMemoryService,
    '/work',
    's',
    'q',
    controller.signal,
  );
  controller.abort();
  await expect(result).resolves.toBe('');
});
