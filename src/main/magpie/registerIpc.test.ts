import { ipcMain } from 'electron';
import { expect, test, vi } from 'vitest';
import { magpieContract } from '../../shared/ipc/providersContract';
import { MAGPIE_VERSION } from './integrity';
import type { MagpieManager } from './manager';
import { MagpieModelService } from './modelService';
import { registerMagpieIpc } from './registerIpc';

test('closing model settings stops admission and waits for a pending preference write', async () => {
  const handle = vi.spyOn(ipcMain, 'handle');
  const removeHandler = vi.spyOn(ipcMain, 'removeHandler');
  const update = Promise.withResolvers<{ state: 'stopped'; version: string }>();
  const probe = Promise.withResolvers<{ ok: boolean }>();
  const setSubscriptionAccounts = vi.fn(() => update.promise);
  const manager = {
    setSubscriptionAccounts,
    testProvider: () => probe.promise,
    shutdown: vi.fn(),
  } as unknown as MagpieManager;
  const models = new MagpieModelService(manager, {
    readDefaultModelId: () => null,
    writeDefaultModelId: () => {},
  });
  try {
    const close = registerMagpieIpc(manager, () => true, models);
    const channel = magpieContract.setSubscriptionAccounts.channel;
    const invoke = handle.mock.calls.find(([name]) => name === channel)![1];
    const event = {} as Parameters<typeof invoke>[0];
    const write = invoke(event, true);
    const probeProvider = handle.mock.calls.find(
      ([name]) => name === magpieContract.testProvider.channel,
    )![1];
    const probing = probeProvider(event, {
      name: 'Fixture',
      api: 'openai-completions',
      baseUrl: 'https://example.test',
      models: [],
    });
    const closed = vi.fn();
    const closing = close().then(closed);
    expect(removeHandler).toHaveBeenCalledWith(channel);
    await new Promise(resolve => setImmediate(resolve));
    expect(closed).not.toHaveBeenCalled();
    await expect(invoke(event, false)).rejects.toThrow();
    expect(setSubscriptionAccounts).toHaveBeenCalledOnce();

    update.resolve({ state: 'stopped', version: MAGPIE_VERSION });
    await write;
    await new Promise(resolve => setImmediate(resolve));
    expect(closed).toHaveBeenCalledOnce();
    probe.resolve({ ok: true });
    await Promise.all([closing, probing]);
  } finally {
    update.resolve({ state: 'stopped', version: MAGPIE_VERSION });
    probe.resolve({ ok: true });
    vi.restoreAllMocks();
  }
});
