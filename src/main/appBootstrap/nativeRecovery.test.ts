import { beforeEach, expect, test, vi } from 'vitest';

const services = vi.hoisted(() => ({
  state: 'stopped',
  recoverSessions: vi.fn(),
  startAutomations: vi.fn(),
  retryParked: vi.fn(),
}));
vi.mock('./sessionServices', () => ({
  getPiRuntimeAdapter: () => ({ recoverSessions: services.recoverSessions }),
}));
vi.mock('./automationRuntime', () => ({
  startAutomations: services.startAutomations,
  getScheduledTaskService: () => ({ retryParked: services.retryParked }),
}));
vi.mock('./inferenceRuntimeState', () => ({
  inferenceRuntime: { magpieManager: { status: () => ({ state: services.state }) } },
}));

let runtime: typeof import('./nativeRecovery');
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  services.state = 'stopped';
  services.recoverSessions.mockResolvedValue(undefined);
  services.startAutomations.mockResolvedValue(undefined);
  services.retryParked.mockResolvedValue(undefined);
  runtime = await import('./nativeRecovery');
});

test('defers recovery until native resources are ready', async () => {
  services.state = 'running';
  await runtime.recoverNativeRuntimes();
  expect(services.recoverSessions).not.toHaveBeenCalled();
  expect(services.startAutomations).not.toHaveBeenCalled();
  await runtime.markNativeResourcesReady();
  expect(services.recoverSessions).toHaveBeenCalledOnce();
});

test('a stopped-to-running notification during automation startup recovers pending Work sessions', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  services.startAutomations.mockImplementationOnce(() => {
    started.resolve();
    return release.promise;
  });
  const startup = runtime.markNativeResourcesReady();
  await started.promise;
  services.state = 'running';
  const ready = runtime.recoverNativeRuntimes();
  expect(runtime.recoverNativeRuntimes()).toBe(ready);
  release.resolve();
  await Promise.all([startup, ready]);
  expect(services.recoverSessions).toHaveBeenCalledOnce();
  expect(services.startAutomations).toHaveBeenCalledTimes(2);
});

test('concurrent ready notifications share a flight and do not overlap or restart existing Work', async () => {
  services.state = 'running';
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let active = false;
  let starts = 0;
  let inFlight = 0;
  let peak = 0;
  services.recoverSessions.mockImplementation(async () => {
    peak = Math.max(peak, ++inFlight);
    if (!active) {
      active = true;
      starts++;
    }
    started.resolve();
    await release.promise;
    inFlight--;
  });
  const startup = runtime.markNativeResourcesReady();
  await started.promise;
  const notifications = Array.from({ length: 20 }, () => runtime.recoverNativeRuntimes());
  expect(new Set(notifications).size).toBe(1);
  release.resolve();
  await Promise.all([startup, ...notifications]);
  expect(peak).toBe(1);
  expect(starts).toBe(1);
  expect(services.recoverSessions).toHaveBeenCalledTimes(2);
});

test.each([1, 2, 3, 4])(
  'does not lose a notification %i microtasks after the final awaited step',
  async depth => {
    services.state = 'running';
    const sent = Promise.withResolvers<Promise<void>>();
    services.retryParked.mockImplementationOnce(async () => {
      let notify = () => sent.resolve(runtime.recoverNativeRuntimes());
      for (let index = 0; index < depth; index++) {
        const next = notify;
        notify = () => queueMicrotask(next);
      }
      notify();
    });
    await runtime.markNativeResourcesReady();
    await sent.promise;
    expect(services.recoverSessions).toHaveBeenCalledTimes(2);
    expect(services.startAutomations).toHaveBeenCalledTimes(2);
  },
);

test('a failed sweep releases its flight and the next notification retries', async () => {
  services.startAutomations.mockRejectedValueOnce(new Error('Startup resources unavailable.'));
  await expect(runtime.markNativeResourcesReady()).rejects.toThrow(
    'Startup resources unavailable.',
  );
  services.state = 'running';
  await runtime.recoverNativeRuntimes();
  expect(services.startAutomations).toHaveBeenCalledTimes(2);
  expect(services.recoverSessions).toHaveBeenCalledOnce();
  expect(services.retryParked).toHaveBeenCalledOnce();
});

test('a notification already queued during a failed sweep receives a retry', async () => {
  const started = Promise.withResolvers<void>();
  const fail = Promise.withResolvers<void>();
  services.startAutomations.mockImplementationOnce(() => {
    started.resolve();
    return fail.promise;
  });
  const startup = runtime.markNativeResourcesReady();
  await started.promise;
  services.state = 'running';
  const ready = runtime.recoverNativeRuntimes();
  fail.reject(new Error('Previous attempt failed.'));
  await expect(Promise.all([startup, ready])).resolves.toEqual([undefined, undefined]);
  expect(services.startAutomations).toHaveBeenCalledTimes(2);
  expect(services.recoverSessions).toHaveBeenCalledOnce();
});
