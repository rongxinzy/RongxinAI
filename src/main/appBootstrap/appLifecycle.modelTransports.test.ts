import { expect, test, vi } from 'vitest';

import { loadQuitOrigin, mocks, register } from './appLifecycle.testHarness';

test('update quit reserves time to stop Magpie if external CLI restoration stalls', async () => {
  const restoration = Promise.withResolvers<void>();
  const shutdown = Promise.withResolvers<void>();
  mocks.getStorePreference.mockReturnValue(true);
  mocks.disconnectAgents.mockReturnValue(restoration.promise);
  mocks.stopMagpie.mockReturnValue(shutdown.promise);
  await register();
  const { recordAppQuitOrigin, AppQuitOrigin } = await loadQuitOrigin();
  recordAppQuitOrigin(AppQuitOrigin.UpdateInstall);
  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });

  await vi.advanceTimersByTimeAsync(1_000);
  expect(mocks.stopMagpie).toHaveBeenCalledOnce();
  expect(mocks.disconnectAgents.mock.calls[0][0]?.aborted).toBe(true);
  expect(mocks.exit).not.toHaveBeenCalled();

  restoration.resolve();
  shutdown.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.stopMagpie).toHaveBeenCalledOnce();
  expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
});

test('quit closes Magpie settings admission before restoring external CLI config', async () => {
  const settings = Promise.withResolvers<void>();
  mocks.closeMagpieAdmission.mockReturnValue(settings.promise);
  mocks.getStorePreference.mockReturnValue(true);
  await register();
  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });

  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.closeMagpieAdmission).toHaveBeenCalledBefore(mocks.stopSessionRuntime);
  expect(mocks.disconnectAgents).not.toHaveBeenCalled();
  expect(mocks.stopMagpie).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();

  settings.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.disconnectAgents).toHaveBeenCalledBefore(mocks.stopMagpie);
  expect(mocks.stopMagpie).toHaveBeenCalledBefore(mocks.close);
});

test.each([false, true])(
  'quit keeps model transports available within the memory completion grace period (update: %s)',
  async updateInstall => {
    const promotion = Promise.withResolvers<void>();
    mocks.drainPromotions.mockReturnValue({
      writes: Promise.all([promotion.promise]),
      modelCompletions: Promise.allSettled([promotion.promise.then(() => '')]),
    });
    await register();
    if (updateInstall) {
      const { recordAppQuitOrigin, AppQuitOrigin } = await loadQuitOrigin();
      recordAppQuitOrigin(AppQuitOrigin.UpdateInstall);
    }
    mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(updateInstall ? 499 : 100);
    expect(mocks.stopSessionRuntime).toHaveBeenCalledOnce();
    expect(mocks.closeMagpieAdmission).toHaveBeenCalledOnce();
    expect(mocks.stopLocalInference).toHaveBeenCalledOnce();
    expect(mocks.stopManagedGateway).not.toHaveBeenCalled();
    expect(mocks.stopMagpie).not.toHaveBeenCalled();
    if (!updateInstall) promotion.resolve();
    await vi.advanceTimersByTimeAsync(updateInstall ? 1 : 0);
    expect(mocks.stopManagedGateway).toHaveBeenCalledOnce();
    expect(mocks.stopMagpie).toHaveBeenCalledOnce();
    if (updateInstall) {
      expect(mocks.close).not.toHaveBeenCalled();
      promotion.resolve();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
  },
);

test('local memory writes delay SQLite close without delaying model transport shutdown', async () => {
  const pending = Promise.withResolvers<unknown[]>();
  mocks.drainPromotions.mockReturnValue({
    writes: pending.promise,
    modelCompletions: Promise.resolve([]),
  });
  await register();
  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.stopManagedGateway).toHaveBeenCalledOnce();
  expect(mocks.stopMagpie).toHaveBeenCalledOnce();
  expect(mocks.close).not.toHaveBeenCalled();
  pending.resolve([]);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
});

test('update quit still stops Magpie when a settings write cannot drain', async () => {
  const settings = Promise.withResolvers<void>();
  mocks.closeMagpieAdmission.mockReturnValue(settings.promise);
  mocks.getStorePreference.mockReturnValue(true);
  await register();
  const { recordAppQuitOrigin, AppQuitOrigin } = await loadQuitOrigin();
  recordAppQuitOrigin(AppQuitOrigin.UpdateInstall);
  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });

  await vi.advanceTimersByTimeAsync(1_000);
  expect(mocks.stopMagpie).toHaveBeenCalledOnce();
  expect(mocks.exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4_000);
  expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
  expect(mocks.close).not.toHaveBeenCalled();

  settings.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.disconnectAgents).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
});

test('update quit closes SQLite when only Magpie process shutdown remains', async () => {
  const shutdown = Promise.withResolvers<void>();
  mocks.stopMagpie.mockReturnValue(shutdown.promise);
  await register();
  const { recordAppQuitOrigin, AppQuitOrigin } = await loadQuitOrigin();
  recordAppQuitOrigin(AppQuitOrigin.UpdateInstall);
  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });

  await vi.advanceTimersByTimeAsync(4_999);
  expect(mocks.stopMagpie).toHaveBeenCalledOnce();
  expect(mocks.exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
  shutdown.resolve();
});
