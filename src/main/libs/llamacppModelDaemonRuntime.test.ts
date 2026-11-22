import { EventEmitter, once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createConnection, createServer, type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { LlamaCppBackendError } from '../../shared/llamacpp';
import {
  LLAMACPP_MODEL_DAEMON_HANDOFF,
  LlamaCppModelDaemonCommand,
  type LlamaCppModelDaemonRequest,
} from './llamacppModelDaemonProtocol';
import { LlamaCppModelDaemonRuntime } from './llamacppModelDaemonRuntime';
import type { LlamaCppModelGatewayOptions } from './llamacppModelGateway';
import { LlamaCppModelProcessManager } from './llamacppModelProcessManager';

const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), gateway: vi.fn() }));
vi.mock(import('./llamacppModelGateway'), async importOriginal => ({
  ...(await importOriginal()),
  createLlamaCppModelGateway: (options: LlamaCppModelGatewayOptions) => {
    mocks.gateway(options);
    return { start: mocks.start, stop: mocks.stop, baseUrl: () => null, isChanging: () => false };
  },
}));

test('the gateway loads an unloaded model through the same daemon process owner', async () => {
  mocks.start.mockResolvedValue(undefined);
  mocks.stop.mockResolvedValue(undefined);
  const root = await mkdtemp(path.join(os.tmpdir(), 'llamacpp-daemon-gateway-'));
  const modelPath = path.join(root, 'target.gguf');
  const baseUrl = 'http://127.0.0.1:30000';
  const ensureRunning = vi
    .spyOn(LlamaCppModelProcessManager.prototype, 'ensureRunning')
    .mockResolvedValue({ modelName: 'target', modelPath, port: 30000, baseUrl });
  const getModelBaseUrl = vi
    .spyOn(LlamaCppModelProcessManager.prototype, 'getModelBaseUrl')
    .mockReturnValue(baseUrl);
  const runtime = new LlamaCppModelDaemonRuntime({
    controlPort: 0,
    controlToken: 'fixture',
    userDataPath: root,
    executablePath: '/unused',
    serviceConfig: { modelsDir: root },
  });
  try {
    await writeFile(modelPath, 'GGUF');
    await runtime.start();
    const options: LlamaCppModelGatewayOptions = mocks.gateway.mock.lastCall![0];
    const acquired = options.acquireModel('target');
    await expect.poll(() => ensureRunning.mock.calls.length, { timeout: 500 }).toBe(1);
    expect(ensureRunning).toHaveBeenCalledWith({ model: 'target', modelPath });
    const lease = await acquired;
    expect(lease.baseUrl).toBe(baseUrl);
    lease.release();
  } finally {
    await runtime.shutdown();
    ensureRunning.mockRestore();
    getModelBaseUrl.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

test('daemon control removes only the model file in its active library', async () => {
  mocks.start.mockResolvedValue(undefined);
  mocks.stop.mockResolvedValue(undefined);
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const { port } = reservation.address() as AddressInfo;
  await new Promise<void>((resolve, reject) =>
    reservation.close(error => (error ? reject(error) : resolve())),
  );
  const root = await mkdtemp(path.join(os.tmpdir(), 'llamacpp-daemon-delete-'));
  const modelPath = path.join(root, 'target.gguf');
  const otherPath = path.join(root, 'other.gguf');
  const runtime = new LlamaCppModelDaemonRuntime({
    controlPort: port,
    controlToken: 'fixture',
    userDataPath: root,
    executablePath: '/unused',
    serviceConfig: { modelsDir: root },
  });
  const remove = (file: string) =>
    send({
      command: LlamaCppModelDaemonCommand.DeleteModelFile,
      modelName: 'target',
      modelPath: file,
    });
  const send = (request: LlamaCppModelDaemonRequest) =>
    fetch(`http://127.0.0.1:${port}/control`, {
      method: 'POST',
      headers: { authorization: 'Bearer fixture' },
      body: JSON.stringify(request),
    });
  try {
    await writeFile(modelPath, 'GGUF');
    await writeFile(otherPath, 'GGUF');
    await runtime.start();
    {
      using _processes = vi
        .spyOn(LlamaCppModelProcessManager.prototype, 'list')
        .mockReturnValueOnce([
          { modelName: 'target', modelPath, port: 30000, baseUrl: 'http://127.0.0.1:30000' },
        ]);
      const busy = await send({ command: LlamaCppModelDaemonCommand.ShutdownIfIdle });
      expect(busy.status).toBe(400);
      expect(await busy.json()).toMatchObject({
        error: LlamaCppBackendError.SwitchRequiresStoppedService,
      });
    }
    const rejected = await remove(otherPath);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ success: false });
    expect(await readFile(otherPath, 'utf8')).toBe('GGUF');

    const deleted = await remove(modelPath);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ success: true });
    await expect(readFile(modelPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await runtime.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

test('shutdown waits for a pending gateway bind and does not start the daemon control listener', async () => {
  const listenerBound = Promise.withResolvers<void>();
  const order: string[] = [];
  mocks.start.mockImplementation(async () => {
    await listenerBound.promise;
    order.push('bound');
  });
  mocks.stop.mockImplementation(async () => {
    await listenerBound.promise;
    order.push('stopped');
  });
  const runtime = new LlamaCppModelDaemonRuntime({
    controlPort: 0,
    controlToken: 'fixture',
    userDataPath: '/unused',
    executablePath: '/unused',
    serviceConfig: {},
  });
  try {
    const starting = runtime.start();
    const quitting = runtime.shutdown();
    listenerBound.resolve();

    const [result] = await Promise.allSettled([starting, quitting]);
    expect(result).toMatchObject({ status: 'rejected', reason: expect.any(Error) });
    expect(order).toEqual(['bound', 'stopped']);
    await expect(runtime.start()).rejects.toThrow('shutting down');
  } finally {
    await runtime.shutdown();
  }
});

test('closes gateway admission immediately and retires control after a model stop fails', async () => {
  mocks.start.mockResolvedValue(undefined);
  mocks.stop.mockClear().mockResolvedValue(undefined);
  const stopModels = Promise.withResolvers<void>();
  using _processes = vi
    .spyOn(LlamaCppModelProcessManager.prototype, 'stopAll')
    .mockReturnValue(stopModels.promise);
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const { port } = reservation.address() as AddressInfo;
  reservation.close();
  await once(reservation, 'close');
  const runtime = new LlamaCppModelDaemonRuntime({
    controlPort: port,
    controlToken: 'fixture',
    userDataPath: '/unused',
    executablePath: '/unused',
    serviceConfig: {},
  });
  await runtime.start();
  const socket = createConnection({ host: '127.0.0.1', port });
  const closed = once(socket, 'close');
  try {
    await once(socket, 'connect');
    socket.write(
      'POST /control HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer fixture\r\nContent-Length: 100\r\n\r\n{',
    );
    const quitting = runtime.shutdown();
    const failed = expect(quitting).rejects.toThrow('model process resisted termination');
    expect(mocks.stop).toHaveBeenCalledOnce();
    const send = (command: LlamaCppModelDaemonCommand) =>
      fetch(`http://127.0.0.1:${port}/control`, {
        method: 'POST',
        headers: { authorization: 'Bearer fixture' },
        body: JSON.stringify({ command }),
      });
    expect((await send(LlamaCppModelDaemonCommand.Status)).status).toBe(200);
    expect((await send(LlamaCppModelDaemonCommand.StopAll)).status).toBe(400);
    stopModels.reject(new Error('model process resisted termination'));
    await failed;
    await closed;
    await expect(send(LlamaCppModelDaemonCommand.Status)).rejects.toThrow();
  } finally {
    socket.destroy();
    stopModels.resolve();
    await runtime.shutdown().catch(() => {});
  }
});

test.each([
  { keepRunningOnAppQuit: false, handoff: false, reason: 'shutting down' },
  { keepRunningOnAppQuit: false, handoff: true, reason: 'Local model was not found' },
  { keepRunningOnAppQuit: true, handoff: false, reason: 'Local model was not found' },
])(
  'admits model launches only after the applicable parent handoff ($keepRunningOnAppQuit, $handoff)',
  async ({ keepRunningOnAppQuit, handoff, reason }) => {
    const parent = Object.assign(new EventEmitter(), { exit: vi.fn<() => never>() });
    mocks.start.mockResolvedValue(undefined);
    mocks.stop.mockResolvedValue(undefined);
    const daemon = new LlamaCppModelDaemonRuntime(
      {
        controlPort: 0,
        controlToken: 'fixture',
        userDataPath: '/unused',
        executablePath: '/unused',
        serviceConfig: { keepRunningOnAppQuit },
      },
      parent,
    );
    try {
      await daemon.start();
      const options: LlamaCppModelGatewayOptions = mocks.gateway.mock.lastCall![0];
      const settled = vi.fn();
      const acquiring = options.acquireModel('fixture').catch(error => {
        settled();
        return error;
      });
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(settled).not.toHaveBeenCalled();

      if (handoff) parent.emit('message', LLAMACPP_MODEL_DAEMON_HANDOFF);
      parent.emit('disconnect');
      if (!handoff && !keepRunningOnAppQuit) {
        expect(parent.exit).toHaveBeenCalledWith(0);
        await daemon.shutdown();
      } else {
        expect(parent.exit).not.toHaveBeenCalled();
      }
      expect(await acquiring).toMatchObject({ message: expect.stringContaining(reason) });
    } finally {
      await daemon.shutdown();
    }
  },
);
