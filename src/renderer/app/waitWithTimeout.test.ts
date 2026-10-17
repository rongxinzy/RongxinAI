import { afterEach, expect, test, vi } from 'vitest';

import { waitWithTimeout } from './waitWithTimeout';

afterEach(() => {
  vi.unstubAllGlobals();
});

// The renderer runs this helper against window timers; node-env tests stub the
// global so the same code path is exercised.
const stubWindowTimers = (clearTimeoutSpy = vi.fn()) => {
  vi.stubGlobal('window', {
    setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms) as unknown as number,
    clearTimeout: (id: number) => {
      clearTimeoutSpy();
      clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    },
  });
  return clearTimeoutSpy;
};

test('resolves with the underlying value when the promise settles in time', async () => {
  stubWindowTimers();

  await expect(
    waitWithTimeout(Promise.resolve('ready'), 5_000, 'configService.init'),
  ).resolves.toBe('ready');
});

test('rejects with a labelled error when the promise exceeds the timeout', async () => {
  stubWindowTimers();

  const pending = new Promise<never>(() => {});
  await expect(waitWithTimeout(pending, 5, 'i18nService.initialize')).rejects.toThrow(
    'i18nService.initialize timed out after 5ms',
  );
});

test('propagates the promise rejection and clears the pending timer', async () => {
  const clearTimeoutSpy = stubWindowTimers();

  await expect(
    waitWithTimeout(Promise.reject(new Error('ipc failed')), 5_000, 'enterprise.getConfig'),
  ).rejects.toThrow('ipc failed');
  expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
});
