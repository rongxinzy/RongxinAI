import { EventEmitter } from 'node:events';
import { beforeEach, expect, test, vi } from 'vitest';

import { IntegrationOperation } from '../libs/mcpIntegrationRuntime';
import { FEISHU_MCP_REGISTRY_ID, getMcpIntegrationRuntime } from './feishuConnector';

const { applyEnv, installCli, openExternal, spawn, terminateProcessTree } = vi.hoisted(() => ({
  applyEnv: vi.fn<() => Promise<void>>(),
  installCli: vi.fn(),
  openExternal: vi.fn(),
  spawn: vi.fn(),
  terminateProcessTree: vi.fn<() => Promise<void>>(),
}));

vi.mock('child_process', () => ({ spawn }));
vi.mock('electron', async importOriginal => ({
  ...(await importOriginal<typeof import('electron')>()),
  shell: { openExternal },
}));
vi.mock('fs', async importOriginal => {
  const fs = await importOriginal<typeof import('fs')>();
  return {
    ...fs,
    default: { ...fs.default, existsSync: () => true, promises: { mkdir: async () => {} } },
  };
});
vi.mock('../libs/coworkUtil', () => ({ applyApplicationRuntimeEnv: applyEnv }));
vi.mock('../libs/feishuCliDownloader', () => ({ installDownloadedFeishuCli: installCli }));
vi.mock('../libs/ownedProcessStop', () => ({ terminateProcessTree }));

class FixtureChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

beforeEach(() => {
  vi.resetAllMocks();
  applyEnv.mockResolvedValue();
  spawn.mockImplementation(() => {
    const child = new FixtureChild();
    queueMicrotask(() => child.emit('close', 0));
    return child;
  });
});

function authorize(signal: AbortSignal) {
  return getMcpIntegrationRuntime().run(
    FEISHU_MCP_REGISTRY_ID,
    IntegrationOperation.Authenticate,
    signal,
  );
}

test('cancellation during Feishu login environment resolution prevents a late launch', async () => {
  const resolving = Promise.withResolvers<void>();
  const environment = Promise.withResolvers<void>();
  applyEnv
    .mockResolvedValueOnce()
    .mockResolvedValueOnce()
    .mockImplementationOnce(() => {
      resolving.resolve();
      return environment.promise;
    });
  const controller = new AbortController();
  const operation = authorize(controller.signal);
  await resolving.promise;
  controller.abort(new Error('cancelled'));
  environment.resolve();

  await expect(operation).resolves.toMatchObject({ error: 'cancelled' });
  expect(spawn.mock.calls.map(([, args]) => args)).toEqual([['--version'], ['config', 'show']]);
  expect(installCli).not.toHaveBeenCalled();
  expect(openExternal).not.toHaveBeenCalled();
});

test('cancellation after the Feishu CLI returns a verification URL prevents opening it', async () => {
  const launching = Promise.withResolvers<FixtureChild>();
  const prepareCommand = spawn.getMockImplementation()!;
  spawn.mockImplementation((command, args, options) => {
    if (!args.includes('--no-wait')) return prepareCommand(command, args, options);
    const child = new FixtureChild();
    launching.resolve(child);
    return child;
  });
  const controller = new AbortController();
  const operation = authorize(controller.signal);
  const child = await launching.promise;
  child.stdout.emit(
    'data',
    JSON.stringify({ device_code: 'fixture', verification_url: 'https://example.test/' }),
  );
  child.emit('close', 0);
  controller.abort(new Error('cancelled'));

  await expect(operation).resolves.toMatchObject({ error: 'cancelled' });
  expect(spawn).toHaveBeenCalledTimes(3);
  expect(openExternal).not.toHaveBeenCalled();
});

test('authorization cancellation waits for the running preflight process tree', async () => {
  const launched = Promise.withResolvers<FixtureChild>();
  const reaped = Promise.withResolvers<void>();
  const child = new FixtureChild();
  spawn.mockImplementationOnce(() => {
    launched.resolve(child);
    return child;
  });
  terminateProcessTree.mockReturnValueOnce(reaped.promise);
  const controller = new AbortController();
  const settled = vi.fn();
  const operation = authorize(controller.signal).then(settled);

  await launched.promise;
  controller.abort(new Error('cancelled'));
  child.emit('close', 0);
  await Promise.resolve();
  expect(terminateProcessTree).toHaveBeenCalledExactlyOnceWith(child);
  expect(settled).not.toHaveBeenCalled();
  expect(spawn).toHaveBeenCalledExactlyOnceWith(
    expect.any(String),
    ['--version'],
    expect.objectContaining({ detached: process.platform !== 'win32' }),
  );
  reaped.resolve();
  await operation;
  expect(settled).toHaveBeenCalledWith(expect.objectContaining({ error: 'cancelled' }));
  expect(installCli).not.toHaveBeenCalled();
  expect(openExternal).not.toHaveBeenCalled();
});
