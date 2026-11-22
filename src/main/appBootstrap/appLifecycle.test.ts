import { expect, test, vi } from 'vitest';

import {
  lifecycleRuntime,
  loadQuitOrigin,
  mocks,
  register,
  signals,
} from './appLifecycle.testHarness';

test('application exit joins Skill script cleanup after stopping Pi', async () => {
  const scripts = Promise.withResolvers<void>();
  mocks.stopSkillScripts.mockReturnValue(scripts.promise);
  await register();

  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.stopSessionRuntime).toHaveBeenCalledBefore(mocks.stopSkillScripts);
  expect(mocks.exit).not.toHaveBeenCalled();

  scripts.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
});

test('application quit stops the desktop pet before draining its sensors', async () => {
  const sensors = Promise.withResolvers<void>();
  mocks.drainDesktopPetSensors.mockReturnValue(sensors.promise);
  await register();

  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.disposeDesktopPet).toHaveBeenCalledBefore(mocks.drainDesktopPetSensors);
  expect(mocks.exit).not.toHaveBeenCalled();

  sensors.reject(new Error('sensor exit missing'));
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
});

test('SQLite stays open until admitted companion requests finish', async () => {
  const requests = Promise.withResolvers<void>();
  mocks.disposeCompanionWindow.mockReturnValue(requests.promise);
  await register();

  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.disposeCompanionWindow).toHaveBeenCalledBefore(mocks.interruptCompanion);
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.exit).not.toHaveBeenCalled();

  requests.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
});

test('orderly quit stops admissions before Pi and closes SQLite before exit', async () => {
  const update = Promise.withResolvers<void>();
  mocks.stopUpdates.mockReturnValue(update.promise);
  await register();
  const preventDefault = vi.fn();
  mocks.on.mock.calls[0][1]({ preventDefault });
  await vi.advanceTimersByTimeAsync(0);
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(mocks.persistWindowState).toHaveBeenCalledBefore(mocks.stopSessionRuntime);
  expect(mocks.stopChannel).toHaveBeenCalledBefore(mocks.stopSessionRuntime);
  expect(mocks.stopChannel).toHaveBeenCalledBefore(mocks.stopChannelProcesses);
  expect(mocks.stopSessionRuntime).toHaveBeenCalledBefore(mocks.shutdownCodingRoom);
  expect(mocks.interruptCompanion).toHaveBeenCalledBefore(mocks.stopSessionRuntime);
  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
  expect(mocks.stopUpdates).toHaveBeenCalledOnce();
  expect(mocks.shutdownMemory).toHaveBeenCalledBefore(mocks.stopEngram);
  expect(mocks.close).not.toHaveBeenCalled();
  update.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
  expect(mocks.stopEngram).toHaveBeenCalledBefore(mocks.close);
  expect(mocks.stopTodoReminders).toHaveBeenCalledBefore(mocks.close);
  expect(mocks.stopLocalInference).toHaveBeenCalledOnce();
  expect(mocks.stopLocalInference).toHaveBeenCalledBefore(mocks.close);
  expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
});

test.each([true, false])('quit closes SQLite only if startup drains in time (%s)', async drains => {
  const startup = Promise.withResolvers<void>();
  await register(startup.promise);
  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(mocks.stopSessionRuntime).toHaveBeenCalledOnce();
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.exit).not.toHaveBeenCalled();

  if (drains) {
    startup.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
  } else {
    await vi.advanceTimersByTimeAsync(14_000);
    expect(mocks.close).not.toHaveBeenCalled();
    startup.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.close).not.toHaveBeenCalled();
  }
  expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
});

test('startup failure runs the same cleanup and exits with an error code', async () => {
  const startup = Promise.withResolvers<void>();
  const engram = Promise.withResolvers<void>();
  mocks.stopEngram.mockReturnValue(engram.promise);
  await register(startup.promise);

  startup.reject(new Error('Fixture database could not open'));
  await vi.advanceTimersByTimeAsync(0);
  const { getAppQuitOrigin, AppQuitOrigin } = await loadQuitOrigin();
  expect(getAppQuitOrigin()).toBe(AppQuitOrigin.StartupFailure);
  expect(mocks.stopMagpie).toHaveBeenCalledOnce();
  expect(mocks.stopEngram).toHaveBeenCalledOnce();
  expect(mocks.exit).not.toHaveBeenCalled();

  engram.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
  expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(1);
});

test('a synchronous session runtime stop failure still drains other services and leaves SQLite open', async () => {
  mocks.stopSessionRuntime.mockImplementationOnce(() => {
    throw new Error('Session runtime stop failed');
  });
  const processShutdown = Promise.withResolvers<void>();
  mocks.stopPython.mockReturnValue(processShutdown.promise);
  await register();
  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.stopPython).toHaveBeenCalledOnce();
  expect(mocks.exit).not.toHaveBeenCalled();
  processShutdown.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
  expect(mocks.close).not.toHaveBeenCalled();
});

test('a tray cleanup failure still stops agents and permits the SQLite close', async () => {
  mocks.destroyTray.mockImplementationOnce(() => {
    throw new Error('Tray already disposed');
  });
  await register();
  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.stopSessionRuntime).toHaveBeenCalledOnce();
  expect(mocks.stopPython).toHaveBeenCalledOnce();
  expect(mocks.stopEngram).toHaveBeenCalledBefore(mocks.close);
  expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
});

test.each(['stopChannel', 'stopBackup', 'stopUpdates'] as const)(
  'a synchronous failure to begin %s preserves the rest of cleanup and SQLite writer protection',
  async failingStop => {
    mocks[failingStop].mockImplementationOnce(() => {
      throw new Error('Could not start drain');
    });
    await register();
    mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.stopChannel).toHaveBeenCalledBefore(mocks.stopSessionRuntime);
    expect(mocks.stopBackup).toHaveBeenCalledOnce();
    expect(mocks.stopUpdates).toHaveBeenCalledOnce();
    expect(mocks.stopSessionRuntime).toHaveBeenCalledOnce();
    expect(mocks.stopPython).toHaveBeenCalledOnce();
    expect(mocks.stopEngram).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
  },
);

test.each(signals)('%s remains handled while application cleanup drains', async signal => {
  const drain = Promise.withResolvers<void>();
  mocks.stopChannel.mockReturnValue(drain.promise);
  await register();
  const listener = process.rawListeners(signal).at(-1)!;

  listener.call(process, signal);
  expect(process.rawListeners(signal)).toContain(listener);
  listener.call(process, signal);
  expect(mocks.stopChannel).toHaveBeenCalledOnce();
  expect(mocks.exit).not.toHaveBeenCalled();

  drain.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
  expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
});

test.each(signals)(
  '%s closes SQLite at the normal deadline if only a subprocess is stuck',
  async signal => {
    const processShutdown = Promise.withResolvers<void>();
    mocks.stopPython.mockReturnValue(processShutdown.promise);
    const handlers = await register();
    handlers[signal]();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(mocks.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
    expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
    processShutdown.resolve();
  },
);

test.each([
  ['stopChannel', false],
  ['shutdownMcpOAuthRefreshes', true],
  ['shutdownMcpAuthorizations', true],
] as const)(
  'update quit handles SQLite at the deadline during %s',
  async (pendingStop, storeCanClose) => {
    const cleanup = Promise.withResolvers<void>();
    mocks[pendingStop].mockReturnValue(cleanup.promise);
    await register();
    const { recordAppQuitOrigin, AppQuitOrigin } = await loadQuitOrigin();
    recordAppQuitOrigin(AppQuitOrigin.UpdateInstall);
    mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(mocks.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
    if (storeCanClose) expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
    else expect(mocks.close).not.toHaveBeenCalled();
    cleanup.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.close).toHaveBeenCalledTimes(Number(storeCanClose));
  },
);

test.each([true, false])(
  'a stalled CAD viewer permits SQLite close only after the session runtime drains (%s)',
  async drained => {
    const sessions = Promise.withResolvers<void>();
    const viewer = Promise.withResolvers<void>();
    mocks.stopSessionRuntime.mockReturnValue({
      drained: drained ? Promise.resolve() : sessions.promise,
      viewerStopped: viewer.promise,
    });
    await register();
    const { recordAppQuitOrigin, AppQuitOrigin } = await loadQuitOrigin();
    recordAppQuitOrigin(AppQuitOrigin.UpdateInstall);
    mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(mocks.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
    if (drained) expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
    else expect(mocks.close).not.toHaveBeenCalled();
    sessions.resolve();
    viewer.resolve();
  },
);

test.each([true, false])(
  'backup publication may outlive SQLite at the update deadline after the source copy releases (%s)',
  async sourceReleased => {
    const copy = Promise.withResolvers<never>();
    const publication = Promise.withResolvers<never>();
    mocks.stopBackup.mockReturnValue({
      sourceReleased: sourceReleased ? Promise.resolve([]) : Promise.allSettled([copy.promise]),
      finished: publication.promise,
    });
    await register();
    const { recordAppQuitOrigin, AppQuitOrigin } = await loadQuitOrigin();
    recordAppQuitOrigin(AppQuitOrigin.UpdateInstall);
    mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(5_000);
    if (sourceReleased) expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
    else expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
  },
);

test.each([true, false])(
  'a stalled Coding Room probe does not protect SQLite after turns drain (%s)',
  async drained => {
    const turns = Promise.withResolvers<void>();
    const probes = Promise.withResolvers<void>();
    mocks.shutdownCodingRoom.mockReturnValue({
      drained: drained ? Promise.resolve() : turns.promise,
      probesStopped: probes.promise,
    });
    await register();
    const { recordAppQuitOrigin, AppQuitOrigin } = await loadQuitOrigin();
    recordAppQuitOrigin(AppQuitOrigin.UpdateInstall);
    mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
    if (drained) expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
    else expect(mocks.close).not.toHaveBeenCalled();
  },
);

test('closes SQLite at the update deadline when channel ingress drained but the sidecar is stuck', async () => {
  const sidecar = Promise.withResolvers<void>();
  mocks.stopChannelProcesses.mockReturnValue(sidecar.promise);
  await register();
  const { recordAppQuitOrigin, AppQuitOrigin } = await loadQuitOrigin();
  recordAppQuitOrigin(AppQuitOrigin.UpdateInstall);
  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });

  await vi.advanceTimersByTimeAsync(4_999);
  expect(mocks.stopChannelProcesses).toHaveBeenCalledOnce();
  expect(mocks.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
  sidecar.resolve();
});

test('closes SQLite at the update deadline when MCP OAuth drained but the transport is stuck', async () => {
  const refreshes = Promise.withResolvers<void>();
  const transport = Promise.withResolvers<void>();
  mocks.shutdownMcpOAuthRefreshes.mockReturnValue(refreshes.promise);
  mocks.shutdownMcp.mockReturnValue(transport.promise);
  await register();
  const { recordAppQuitOrigin, AppQuitOrigin } = await loadQuitOrigin();
  recordAppQuitOrigin(AppQuitOrigin.UpdateInstall);
  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });

  await vi.advanceTimersByTimeAsync(4_999);
  expect(mocks.shutdownMcpOAuthRefreshes).toHaveBeenCalledOnce();
  expect(mocks.shutdownMcp).toHaveBeenCalledOnce();
  expect(mocks.exit).not.toHaveBeenCalled();
  refreshes.resolve();
  await vi.advanceTimersByTimeAsync(1);

  expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
  expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
  transport.resolve();
});

test('exits with SQLite left open when a writer cannot confirm its drain', async () => {
  mocks.stopChannel.mockRejectedValue(new Error('bridge drain failed'));
  await register();
  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
  expect(mocks.close).not.toHaveBeenCalled();
});

test.each([true, false])(
  'a stuck inference process permits SQLite close only if its requests drained (%s)',
  async requestsDrained => {
    const processExit = Promise.withResolvers<void>();
    const requestDrain = Promise.withResolvers<void>();
    if (requestsDrained) requestDrain.resolve();
    mocks.stopLocalInference.mockReturnValue({
      stopped: processExit.promise,
      drained: requestDrain.promise,
    });
    await register();
    mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });

    await vi.advanceTimersByTimeAsync(14_999);
    expect(mocks.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(mocks.exit).toHaveBeenCalledOnce();
    if (requestsDrained) expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
    else expect(mocks.close).not.toHaveBeenCalled();
    processExit.resolve();
    requestDrain.resolve();
  },
);

test('a stuck Engram process does not block SQLite close after memory writes drain', async () => {
  const writes = Promise.withResolvers<void>();
  const processExit = Promise.withResolvers<void>();
  mocks.shutdownMemory.mockReturnValue(writes.promise);
  mocks.stopEngram.mockReturnValue(processExit.promise);
  const handlers = await register();
  handlers.SIGTERM();

  await vi.advanceTimersByTimeAsync(1_000);
  expect(mocks.stopEngram).not.toHaveBeenCalled();
  writes.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.stopEngram).toHaveBeenCalledOnce();
  expect(mocks.close).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(14_000);
  expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
  processExit.resolve();
});

test('reserves time to stop Engram even when memory writes cannot finish', async () => {
  const writes = Promise.withResolvers<void>();
  mocks.shutdownMemory.mockReturnValue(writes.promise);
  await register();
  const { recordAppQuitOrigin, AppQuitOrigin } = await loadQuitOrigin();
  recordAppQuitOrigin(AppQuitOrigin.UpdateInstall);
  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });

  await vi.advanceTimersByTimeAsync(2_499);
  expect(mocks.stopEngram).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.stopEngram).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2_500);
  expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
  expect(mocks.close).not.toHaveBeenCalled();
  writes.resolve();
});

test('closes SQLite at the deadline if only Skill tombstone cleanup remains', async () => {
  const cleanup = Promise.withResolvers<void>();
  mocks.stopSkillWatcher.mockReturnValue(cleanup.promise);
  await register();
  const { recordAppQuitOrigin, AppQuitOrigin } = await loadQuitOrigin();
  recordAppQuitOrigin(AppQuitOrigin.UpdateInstall);
  mocks.on.mock.calls[0][1]({ preventDefault: vi.fn() });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(mocks.stopSkillWatcher).toHaveBeenCalledOnce();
  expect(mocks.close).toHaveBeenCalledBefore(mocks.exit);
  cleanup.resolve();
});
