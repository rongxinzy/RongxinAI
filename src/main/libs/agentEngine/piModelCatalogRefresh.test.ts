import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { PiModelCatalogRefreshCoordinator } from './piModelCatalogRefresh';

describe('PiModelCatalogRefreshCoordinator', () => {
  const setRuntimeApiKey = vi.fn(async () => undefined);
  const refresh = vi.fn(async () => ({ aborted: false, errors: new Map() }));
  const createRuntime = vi.fn(async () => ({ setRuntimeApiKey, refresh }));

  beforeEach(() => {
    vi.useRealTimers();
    setRuntimeApiKey.mockReset();
    setRuntimeApiKey.mockImplementation(async () => undefined);
    refresh.mockReset();
    refresh.mockImplementation(async () => ({ aborted: false, errors: new Map() }));
    createRuntime.mockReset();
    createRuntime.mockImplementation(async () => ({ setRuntimeApiKey, refresh }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('registers configured Pi providers before a bounded network refresh', async () => {
    const coordinator = new PiModelCatalogRefreshCoordinator({
      resolveApiKeys: () => ({ DEEPSEEK: 'sk-deepseek', MINIMAX: 'sk-minimax' }),
      createRuntime,
    });

    coordinator.start();
    await coordinator.requestRefresh(false);

    expect(createRuntime).toHaveBeenCalledOnce();
    expect(setRuntimeApiKey.mock.calls).toEqual([
      ['deepseek', 'sk-deepseek'],
      ['minimax-cn', 'sk-minimax'],
    ]);
    expect(refresh).toHaveBeenCalledWith({
      allowNetwork: true,
      signal: expect.any(AbortSignal),
    });
    await coordinator.stop();
  });

  test('does not create a runtime when no Pi catalog provider is configured', async () => {
    const coordinator = new PiModelCatalogRefreshCoordinator({
      resolveApiKeys: () => ({ CUSTOM_0: 'sk-custom' }),
      createRuntime,
    });

    coordinator.start();
    await coordinator.requestRefresh(false);

    expect(createRuntime).not.toHaveBeenCalled();
    await coordinator.stop();
  });

  test('ignores configuration writes when Pi provider credentials are unchanged', async () => {
    const coordinator = new PiModelCatalogRefreshCoordinator({
      resolveApiKeys: () => ({ DEEPSEEK: 'sk-deepseek' }),
      createRuntime,
    });

    coordinator.start();
    await coordinator.requestRefresh(false);
    coordinator.notifyConfigurationChanged();
    await Promise.resolve();

    expect(createRuntime).toHaveBeenCalledOnce();
    await coordinator.stop();
  });

  test('refreshes configured provider catalogs on the periodic interval', async () => {
    vi.useFakeTimers();
    const coordinator = new PiModelCatalogRefreshCoordinator({
      resolveApiKeys: () => ({ DEEPSEEK: 'sk-deepseek' }),
      createRuntime,
      refreshIntervalMs: 100,
    });

    coordinator.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(createRuntime).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(100);
    expect(createRuntime).toHaveBeenCalledTimes(2);
    await coordinator.stop();
  });

  test('coalesces concurrent refresh requests', async () => {
    let finishRefresh: ((value: PiCatalogRefreshResult) => void) | undefined;
    type PiCatalogRefreshResult = { aborted: boolean; errors: Map<string, unknown> };
    refresh.mockImplementationOnce(
      () =>
        new Promise<PiCatalogRefreshResult>(resolve => {
          finishRefresh = resolve;
        }),
    );
    const coordinator = new PiModelCatalogRefreshCoordinator({
      resolveApiKeys: () => ({ DEEPSEEK: 'sk-deepseek' }),
      createRuntime,
    });

    coordinator.start();
    const first = coordinator.requestRefresh(true);
    const second = coordinator.requestRefresh(true);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    finishRefresh?.({ aborted: false, errors: new Map() });
    await Promise.all([first, second]);

    expect(createRuntime).toHaveBeenCalledOnce();
    await coordinator.stop();
  });

  test('runs one follow-up refresh when credentials change during an active refresh', async () => {
    let apiKeys = { DEEPSEEK: 'sk-old' };
    let finishRefresh: ((value: PiCatalogRefreshResult) => void) | undefined;
    type PiCatalogRefreshResult = { aborted: boolean; errors: Map<string, unknown> };
    refresh.mockImplementationOnce(
      () =>
        new Promise<PiCatalogRefreshResult>(resolve => {
          finishRefresh = resolve;
        }),
    );
    const coordinator = new PiModelCatalogRefreshCoordinator({
      resolveApiKeys: () => apiKeys,
      createRuntime,
    });

    coordinator.start();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    apiKeys = { DEEPSEEK: 'sk-new' };
    coordinator.notifyConfigurationChanged();
    finishRefresh?.({ aborted: false, errors: new Map() });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));

    expect(setRuntimeApiKey).toHaveBeenLastCalledWith('deepseek', 'sk-new');
    await coordinator.stop();
  });

  test('aborts a stalled network refresh at the configured deadline', async () => {
    vi.useFakeTimers();
    refresh.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise(resolve => {
          signal.addEventListener('abort', () => resolve({ aborted: true, errors: new Map() }), {
            once: true,
          });
        }),
    );
    const coordinator = new PiModelCatalogRefreshCoordinator({
      resolveApiKeys: () => ({ DEEPSEEK: 'sk-deepseek' }),
      createRuntime,
      refreshTimeoutMs: 25,
    });

    coordinator.start();
    await vi.advanceTimersByTimeAsync(25);
    await coordinator.requestRefresh(false);

    const signal = refresh.mock.calls[0]?.[0]?.signal as AbortSignal;
    expect(signal.aborted).toBe(true);
    await coordinator.stop();
  });

  test('aborts an active network refresh when stopped', async () => {
    refresh.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise(resolve => {
          signal.addEventListener('abort', () => resolve({ aborted: true, errors: new Map() }), {
            once: true,
          });
        }),
    );
    const coordinator = new PiModelCatalogRefreshCoordinator({
      resolveApiKeys: () => ({ DEEPSEEK: 'sk-deepseek' }),
      createRuntime,
    });

    coordinator.start();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const signal = refresh.mock.calls[0]?.[0]?.signal as AbortSignal;
    await coordinator.stop();

    expect(signal.aborted).toBe(true);
  });

  test('allows a later refresh after Pi reports provider errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    refresh
      .mockResolvedValueOnce({
        aborted: false,
        errors: new Map([['deepseek', new Error('catalog unavailable')]]),
      })
      .mockResolvedValueOnce({ aborted: false, errors: new Map() });
    const coordinator = new PiModelCatalogRefreshCoordinator({
      resolveApiKeys: () => ({ DEEPSEEK: 'sk-deepseek' }),
      createRuntime,
    });

    coordinator.start();
    await coordinator.requestRefresh(false);
    await coordinator.requestRefresh(true);

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      '[PiModelCatalog] background refresh kept the existing cache after 1 provider error(s)',
    );
    warn.mockRestore();
    await coordinator.stop();
  });

  test('contains credential resolver failures', async () => {
    const error = new Error('store unavailable');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const coordinator = new PiModelCatalogRefreshCoordinator({
      resolveApiKeys: () => {
        throw error;
      },
      createRuntime,
    });

    coordinator.start();
    await coordinator.requestRefresh(false);

    expect(createRuntime).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[PiModelCatalog] could not read provider credentials:',
      error,
    );
    warn.mockRestore();
    await coordinator.stop();
  });
});
