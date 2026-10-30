import { createRequire } from 'node:module';

import { afterEach, describe, expect, test, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createSignAsyncWithTimestampRetry,
  isAppleTimestampServiceUnavailableError,
  retryMacSignOnTimestampUnavailable,
} = require('./macos-sign-timestamp-retry.cjs');

describe('macos-sign-timestamp-retry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('detects Apple timestamp service errors in message and stderr', () => {
    expect(
      isAppleTimestampServiceUnavailableError(
        new Error('codesign failed: The timestamp service is not available.'),
      ),
    ).toBe(true);
    expect(
      isAppleTimestampServiceUnavailableError({
        message: 'Command failed',
        stderr: 'The timestamp service is not available.\n',
      }),
    ).toBe(true);
    expect(isAppleTimestampServiceUnavailableError(new Error('resource busy'))).toBe(false);
  });

  test('retries only transient timestamp failures', async () => {
    const task = vi
      .fn()
      .mockRejectedValueOnce(new Error('The timestamp service is not available.'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    await retryMacSignOnTimestampUnavailable(task, {
      maxAttempts: 3,
      initialDelayMs: 100,
      backoffMs: 50,
      sleep,
      log,
    });

    expect(task).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(100);
    expect(log).toHaveBeenCalledOnce();
  });

  test('fails fast on non-timestamp codesign errors', async () => {
    const task = vi.fn().mockRejectedValue(new Error('errSecInternalComponent'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      retryMacSignOnTimestampUnavailable(task, { maxAttempts: 3, sleep }),
    ).rejects.toThrow('errSecInternalComponent');
    expect(task).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('wraps signAsync for the custom macOS sign hook', async () => {
    const signAsync = vi
      .fn()
      .mockRejectedValueOnce(new Error('The timestamp service is not available.'))
      .mockResolvedValueOnce(undefined);
    const sign = createSignAsyncWithTimestampRetry(signAsync);

    await sign({ app: '/tmp/Test.app' });

    expect(signAsync).toHaveBeenCalledTimes(2);
    expect(signAsync).toHaveBeenCalledWith({ app: '/tmp/Test.app' });
  });
});
