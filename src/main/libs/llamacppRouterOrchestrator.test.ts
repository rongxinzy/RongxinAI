import type { SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  classifyLlamaCppModelLoadError,
  LlamaCppModelLoadFailureReason,
} from './llamacppModelLoadErrors';
import type { LlamaCppModel, LlamaCppServiceConfig } from '../../shared/llamacpp';
import { LlamaCppOrchestrator } from '../../shared/llamacpp';
import { LlamaCppRouterOrchestrator } from './llamacppRouterOrchestrator';
import { buildLlamaCppRouterProcessArgs } from './llamacppRouterProcess';
import { LlamaCppClient } from './llamacppClient';

const mocks = vi.hoisted(() => ({ scanLocalModels: vi.fn() }));
vi.mock('./llamacppRuntimePaths', async importOriginal => ({
  ...(await importOriginal<typeof import('./llamacppRuntimePaths')>()),
  findLlamaCppExecutable: async () => '/fake/llama-server',
}));
vi.mock('../workbenchTask/artifactWorkerPool', () => ({
  scanLocalModelsAsync: mocks.scanLocalModels,
}));

/**
 * Real llama-server b9244 failure tail (prefix already stripped by the
 * splitter), captured from /workspace/router-lab/router.log around the
 * corrupted-tensor load failure of model `corrupt`.
 */
const CORRUPT_MODEL_LOG_TAIL = [
  "0.00.009.409 I srv    load_model: loading model '/workspace/router-lab/mdir/corrupt-trunc.gguf'",
  "0.00.021.371 E llama_model_load: error loading model: tensor 'token_embd.weight' data is not within the file bounds, model is corrupted or incomplete",
  '0.00.021.382 E llama_model_load_from_file_impl: failed to load model',
  "0.00.030.948 E common_init_from_params: failed to load model '/workspace/router-lab/mdir/corrupt-trunc.gguf'",
  '0.00.031.340 E srv          main: exiting due to model loading error',
];

// A CUDA out-of-memory line as it appears in child output.
const CUDA_OOM_LOG_LINE =
  '0.12.345.678 E ggml-cuda: CUDA error: out of memory while allocating device buffer';

describe('buildLlamaCppRouterProcessArgs', () => {
  test('pins loopback host, an ephemeral port and unlimited router-side models', () => {
    const args = buildLlamaCppRouterProcessArgs({
      config: { port: '8080', modelsMax: '3', host: '0.0.0.0' },
      modelsDir: '/models',
      presetPath: '/preset.ini',
      port: 49152,
    });

    expect(getArgValue(args, '--host')).toBe('127.0.0.1');
    expect(getArgValue(args, '--port')).toBe('49152');
    // The gateway owns config.port; the router must not bind it.
    expect(getArgValue(args, '--port')).not.toBe('8080');
    expect(getArgValue(args, '--models-max')).toBe('0');
    expect(args.filter(entry => entry === '--models-max')).toHaveLength(1);
    expect(args).toContain('--no-models-autoload');
  });
});

describe('LlamaCppRouterOrchestrator', () => {
  test('stopAll waits for the router to report that the resident model exited', async () => {
    await orchestrator.applyConfig({ port: String(gatewayPort) });
    modelStates.set('resident', 'loaded');
    const unload = vi.fn();
    unloadHandler = unload;
    const finished = vi.fn();
    const stopping = orchestrator.stopAll().then(finished);
    await expect.poll(() => unload.mock.calls.length).toBe(1);
    expect(finished).not.toHaveBeenCalled();
    modelStates.set('resident', 'unloaded');
    await stopping;
    expect(finished).toHaveBeenCalledOnce();
  });

  test.skipIf(process.platform === 'win32')(
    'quit terminates the router group after the parent exits',
    async () => {
      const signalGroup = vi.mocked(process.kill);
      signalGroup.mockImplementation((pid, signal) => {
        expect(pid).toBe(-fakeChild.pid);
        if (signal === 'SIGTERM') fakeChild.kill(signal);
        return true;
      });
      await orchestrator.start();

      expect(spawnCalls[0]?.options).toMatchObject({
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      await orchestrator.shutdownForQuit();

      expect(signalGroup.mock.calls).toEqual([
        [-fakeChild.pid, 'SIGTERM'],
        [-fakeChild.pid, 'SIGKILL'],
      ]);
    },
  );

  let routerServer: http.Server | null = null;
  let gatewayPort = 0;
  let routerCalls: Array<{ method: string; url: string }>;
  let loadHandler: (model: string) => void;
  let unloadHandler: (model: string) => void;
  let fakeChild: FakeChildProcess;
  let spawnCalls: Array<{ command: string; args: string[]; options: SpawnOptions }>;
  let orchestrator: LlamaCppRouterOrchestrator;
  let userDataPath: string;
  let modelsDir: string;
  /** model name -> router status value; drives the fake /models payload. */
  let modelStates: Map<string, string>;

  beforeEach(async () => {
    routerCalls = [];
    spawnCalls = [];
    userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-router-test-'));
    modelsDir = path.join(userDataPath, 'models');
    modelStates = new Map();
    mocks.scanLocalModels.mockReset();
    mocks.scanLocalModels.mockResolvedValue([]);
    loadHandler = model => {
      modelStates.set(model, 'loaded');
    };
    unloadHandler = model => {
      modelStates.set(model, 'unloaded');
    };
    fakeChild = new FakeChildProcess();
    const kill = process.kill;
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === -fakeChild.pid) {
        throw Object.assign(new Error('Fake process has no process group'), { code: 'ESRCH' });
      }
      return kill(pid, signal);
    });

    // Reserve an ephemeral port for the gateway so its listener never collides
    // with the fake router or the default 8080, then release it for binding.
    gatewayPort = await reservePort();

    orchestrator = createOrchestrator();
  });

  afterEach(async () => {
    await orchestrator?.stopService().catch(() => undefined);
    await closeRouterServer();
    fs.rmSync(userDataPath, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function createOrchestrator(
    serviceConfig: Partial<LlamaCppServiceConfig> = {},
    resolveExecutable?: () => Promise<string | null>,
    stopPreviousDaemon?: () => Promise<void>,
  ): LlamaCppRouterOrchestrator {
    return new LlamaCppRouterOrchestrator({
      userDataPath,
      getStore: () => makeStore(),
      getServiceConfig: () => ({
        port: String(gatewayPort),
        orchestrator: LlamaCppOrchestrator.Router,
        ...serviceConfig,
      }),
      getModelsDir: () => modelsDir,
      resolveExecutable,
      stopPreviousDaemon,
      spawnProcess: (command, args, options) => {
        spawnCalls.push({ command, args, options });
        // The orchestrator reserved the port in the spawn args; serve the fake
        // router there so health checks and model loads reach this server.
        const port = Number(getArgValue(args, '--port'));
        void startRouterServer(port);
        fakeChild.emitSpawnLines();
        return fakeChild;
      },
      acquireModelLease: async (modelName, load) => {
        await load();
        gatewayLeases.push(modelName);
        return () => undefined;
      },
    });
  }

  const gatewayLeases: string[] = [];
  let storeValues = new Map<string, unknown>();
  function makeStore() {
    storeValues = new Map<string, unknown>();
    return {
      get: <T>(key: string) => storeValues.get(key) as T | undefined,
      set: <T>(key: string, value: T) => void storeValues.set(key, value),
      delete: (key: string) => void storeValues.delete(key),
    };
  }

  function startRouterServer(port: number): Promise<void> {
    routerServer = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const url = request.url ?? '';
        routerCalls.push({ method: request.method ?? '', url });
        const reply = (payload: unknown, status = 200): void => {
          response.statusCode = status;
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify(payload));
        };
        if (url === '/health') return reply({ status: 'ok' });
        if (url === '/models' || url === '/models?reload=1') {
          return reply(
            modelsFixture(
              Array.from(modelStates.entries()).map(([id, value]) => ({
                id,
                value,
                failed: value === 'failed',
                ...(value === 'loaded' || value === 'unloaded' ? { port: 35021 } : {}),
              })),
            ),
          );
        }
        if (url.startsWith('/slots?model=')) {
          return reply([{ id: 0, is_processing: false }]);
        }
        if (url === '/models/load') {
          loadHandler(JSON.parse(body || '{}').model);
          return reply({ success: true });
        }
        if (url === '/models/unload') {
          unloadHandler(JSON.parse(body || '{}').model);
          return reply({ success: true });
        }
        if (url === '/v1/chat/completions') {
          // Minimal successful completion so the client's readiness probe passes.
          return reply({
            id: 'cmpl-probe',
            choices: [{ index: 0, message: { role: 'assistant', content: 'pong' } }],
          });
        }
        reply({ error: { message: `unexpected ${url}` } }, 404);
      });
    });
    return new Promise<void>(resolve => {
      routerServer?.listen(port, '127.0.0.1', () => resolve());
    });
  }

  async function closeRouterServer(): Promise<void> {
    if (!routerServer) return;
    const server = routerServer;
    routerServer = null;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  test('starts the router off config.port with unlimited router-side capacity', async () => {
    await orchestrator.start();

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe('/fake/llama-server');
    const args = spawnCalls[0].args;
    expect(getArgValue(args, '--host')).toBe('127.0.0.1');
    expect(getArgValue(args, '--models-max')).toBe('0');
    expect(args).toContain('--no-models-autoload');
    const routerPort = Number(getArgValue(args, '--port'));
    expect(Number.isInteger(routerPort)).toBe(true);
    expect(routerPort).toBeGreaterThan(0);
    expect(String(routerPort)).not.toBe(String(gatewayPort));
  });

  test('failed startup keeps the child owned until confirmed exit and rejects a replacement', async () => {
    const now = vi.spyOn(Date, 'now');
    vi.spyOn(LlamaCppClient.prototype, 'health').mockImplementationOnce(async () => {
      now.mockReturnValue(Date.now() + 20_000);
      throw new Error('Router health unavailable');
    });
    const kill = vi.spyOn(fakeChild, 'kill').mockReturnValue(true);
    try {
      const results = await Promise.all([orchestrator.start(), orchestrator.start()]);
      expect(results).toEqual([
        expect.objectContaining({
          status: 'stopped',
          error: expect.stringContaining('Router health unavailable'),
        }),
        expect.objectContaining({
          status: 'stopped',
          error: expect.stringContaining('Router health unavailable'),
        }),
      ]);
      expect(kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
      await expect(orchestrator.reconnect({ requireResponsive: true })).rejects.toThrow(
        'still stopping',
      );
      await expect(orchestrator.start()).resolves.toMatchObject({
        status: 'stopped',
        error: expect.stringContaining('still stopping'),
      });
      expect(spawnCalls).toHaveLength(1);
    } finally {
      now.mockRestore();
      kill.mockRestore();
      await orchestrator.stopService();
      await closeRouterServer();
    }
    expect(fakeChild.killed).toBe(true);
    fakeChild = new FakeChildProcess();
    await expect(orchestrator.start()).resolves.toMatchObject({ status: 'running' });
    expect(spawnCalls).toHaveLength(2);
  });

  test('quit joins child termination already started by a failed launch', async () => {
    const now = vi.spyOn(Date, 'now');
    vi.spyOn(LlamaCppClient.prototype, 'health').mockImplementationOnce(async () => {
      now.mockReturnValue(Date.now() + 20_000);
      throw new Error('Router health unavailable');
    });
    const terminating = Promise.withResolvers<void>();
    const kill = vi.spyOn(fakeChild, 'kill').mockImplementation(() => {
      terminating.resolve();
      return true;
    });
    const startup = orchestrator.start();
    await terminating.promise;
    const stopped = vi.fn();
    const quit = orchestrator.shutdownForQuit().then(stopped);
    try {
      await Promise.resolve();
      expect(kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
      expect(stopped).not.toHaveBeenCalled();
    } finally {
      fakeChild.exitCode = 0;
      fakeChild.emit('exit', 0, null);
      await quit;
      now.mockRestore();
    }
    await expect(startup).resolves.toMatchObject({ status: 'stopped' });
    expect(orchestrator.gatewayBaseUrl()).toBeNull();
  });

  test('loads a model through preset reload + POST /models/load and reports it running', async () => {
    modelStates.set('smol', 'unloaded');

    const status = await orchestrator.ensureModel({
      model: 'smol',
      modelPath: '/tmp/llamacpp-router-test-models/smol.gguf',
      options: { ctxSize: 2048 },
    });

    expect(status.status.status).toBe('running');
    expect(status.runningModels.map(model => model.name)).toEqual(['smol']);
    expect(status.runningModels[0].runtime_context_length).toBe(2048);
    const urls = routerCalls.map(call => call.url);
    expect(urls).toContain('/models?reload=1');
    expect(urls).toContain('/models/load');
    expect(urls.slice(urls.indexOf('/v1/chat/completions'))).toEqual(['/v1/chat/completions']);
  });

  test('keeps each model library’s preset and ignores a model lookup from the replaced router', async () => {
    const libraryA = modelsDir;
    const libraryB = path.join(userDataPath, 'other-models');
    const readPreset = (presetPath: string) => fs.readFileSync(presetPath, 'utf8');
    const spawnedPreset = () => getArgValue(spawnCalls.at(-1)!.args, '--models-preset')!;
    const legacyPreset = path.join(userDataPath, 'llamacpp', 'models-preset.ini');
    const legacy = '[legacy]\nmodel = /old-library/legacy.gguf\n';
    fs.mkdirSync(path.dirname(legacyPreset), { recursive: true });
    fs.writeFileSync(legacyPreset, legacy);

    const modelA = path.join(libraryA, 'smol.gguf');
    await orchestrator.ensureModel({
      model: 'smol',
      modelPath: modelA,
      options: { ctxSize: 2048 },
    });
    const presetA = spawnedPreset();
    expect(getArgValue(spawnCalls.at(-1)!.args, '--models-dir')).toBe(libraryA);
    expect(readPreset(presetA)).toContain(`[smol]\nmodel = ${modelA}\nctx-size = 2048`);

    modelsDir = libraryB;
    await orchestrator.applyConfigIfRunning({
      port: String(gatewayPort),
      modelsDir: libraryB,
      gpuLayers: '0',
    });
    expect(spawnCalls).toHaveLength(1);
    expect(readPreset(presetA)).toContain('n-gpu-layers = 0');
    expect(readPreset(presetA)).toContain('ctx-size = 2048');
    const beforeSwitch = readPreset(presetA);
    const lookup = Promise.withResolvers<Array<Pick<LlamaCppModel, 'name' | 'path'>>>();
    mocks.scanLocalModels.mockReturnValueOnce(lookup.promise);
    const staleLoad = expect(orchestrator.ensureModel({ model: 'late' })).rejects.toThrow(
      'The local inference router has stopped.',
    );
    await vi.waitFor(() =>
      expect(mocks.scanLocalModels).toHaveBeenCalledWith(libraryA, expect.any(AbortSignal)),
    );

    const stopFakeRouter = async () => {
      await orchestrator.stopService();
      await closeRouterServer();
      fakeChild = new FakeChildProcess();
      modelStates.clear();
    };
    await stopFakeRouter();
    await orchestrator.start();
    const presetB = spawnedPreset();
    expect(presetB).not.toBe(presetA);
    expect(getArgValue(spawnCalls.at(-1)!.args, '--models-dir')).toBe(libraryB);
    lookup.resolve([{ name: 'late', path: path.join(libraryA, 'late.gguf') }]);
    await staleLoad;
    expect(readPreset(presetA)).toBe(beforeSwitch);
    expect(readPreset(presetB)).not.toContain('[smol]');
    expect(readPreset(presetB)).not.toContain('[late]');

    const modelB = path.join(libraryB, 'smol.gguf');
    await orchestrator.ensureModel({
      model: 'smol',
      modelPath: modelB,
      options: { ctxSize: 8192 },
    });
    expect(readPreset(presetB)).toContain(`[smol]\nmodel = ${modelB}\nctx-size = 8192`);

    await stopFakeRouter();
    modelsDir = libraryA;
    await orchestrator.start();
    expect(spawnedPreset()).toBe(presetA);
    expect(readPreset(presetA)).toContain(`[smol]\nmodel = ${modelA}\nctx-size = 2048`);
    expect(readPreset(legacyPreset)).toBe(legacy);
  });

  test('a failed load throws the model log tail so the classifier maps it', async () => {
    modelStates.set('corrupt', 'failed');
    loadHandler = model => {
      modelStates.set(model, 'failed');
    };
    // The splitter receives the real spawn + failure lines for model corrupt.
    fakeChild.stdoutLines = [
      'some prefix load: spawning server instance with name=corrupt on port 35021',
      ...CORRUPT_MODEL_LOG_TAIL.map(line => `[35021] ${line}`),
    ];

    let error: Error | undefined;
    try {
      await orchestrator.ensureModel({
        model: 'corrupt',
        modelPath: '/tmp/llamacpp-router-test-models/corrupt-trunc.gguf',
      });
    } catch (caught) {
      error = caught as Error;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('corrupt');
    expect(error?.message).toContain(
      "tensor 'token_embd.weight' data is not within the file bounds",
    );
    // The classifier maps the real b9244 tail to the corrupt-file reason.
    expect(classifyLlamaCppModelLoadError(error)).toBe(
      LlamaCppModelLoadFailureReason.ModelFileInvalid,
    );
  });

  test('a CUDA out-of-memory tail classifies as insufficient VRAM', async () => {
    modelStates.set('corrupt', 'failed');
    loadHandler = model => {
      modelStates.set(model, 'failed');
    };
    fakeChild.stdoutLines = [
      'load: spawning server instance with name=corrupt on port 35022',
      `[35022] ${CUDA_OOM_LOG_LINE}`,
    ];

    const error = await orchestrator
      .ensureModel({
        model: 'corrupt',
        modelPath: '/tmp/llamacpp-router-test-models/corrupt-trunc.gguf',
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(classifyLlamaCppModelLoadError(error)).toBe(
      LlamaCppModelLoadFailureReason.VramInsufficient,
    );
  });

  test('stopModel posts /models/unload and drops the model from the running set', async () => {
    modelStates.set('smol', 'loaded');
    const unloadedModels: string[] = [];
    unloadHandler = model => {
      unloadedModels.push(model);
      modelStates.set(model, 'unloaded');
    };
    await orchestrator.start(); // starts router + gateway, caches running models

    const status = await orchestrator.stopModel('smol');

    expect(unloadedModels).toEqual(['smol']);
    expect(routerCalls.some(call => call.url === '/models/unload')).toBe(true);
    expect(status.runningModels.map(model => model.name)).toEqual([]);
  });

  test('model deletion preserves the file until the router confirms unload', async () => {
    const modelPath = path.join(userDataPath, 'smol.gguf');
    fs.writeFileSync(modelPath, 'GGUF');
    modelStates.set('smol', 'loaded');
    const unload = vi.fn();
    unloadHandler = unload;
    await orchestrator.start();

    const deleting = orchestrator.deleteModelFile('smol', modelPath);
    await expect.poll(() => unload.mock.calls.length).toBe(1);
    expect(unload).toHaveBeenCalledExactlyOnceWith('smol');
    expect(fs.existsSync(modelPath)).toBe(true);

    modelStates.set('smol', 'unloaded');
    await deleting;
    expect(fs.existsSync(modelPath)).toBe(false);
  });

  test('shutdownForQuit unloads every loaded model, stops the gateway and kills the router', async () => {
    modelStates.set('smol', 'loaded');
    modelStates.set('qwen', 'loaded');
    const unloadedModels: string[] = [];
    unloadHandler = model => {
      unloadedModels.push(model);
      modelStates.set(model, 'unloaded');
    };
    await orchestrator.start(); // starts router + gateway

    await orchestrator.shutdownForQuit();

    expect(unloadedModels.sort()).toEqual(['qwen', 'smol']);
    expect(fakeChild.killed).toBe(true);
    expect(orchestrator.gatewayBaseUrl()).toBeNull();
  });

  test('quit closes startup admission even when executable resolution is pending', async () => {
    const executable = Promise.withResolvers<string>();
    const resolveExecutable = vi.fn(() => executable.promise);
    orchestrator = createOrchestrator({}, resolveExecutable);
    const starting = orchestrator.start();
    expect(resolveExecutable).toHaveBeenCalledOnce();

    const quitting = orchestrator.shutdownForQuit();
    executable.resolve('/fake/llama-server');
    const [status] = await Promise.all([starting, quitting]);

    expect(spawnCalls.length).toBe(0);
    expect(status).toMatchObject({ status: 'stopped' });
    await expect(orchestrator.listRunningModels()).rejects.toThrow('shutting down');
    expect(resolveExecutable).toHaveBeenCalledOnce();
  });

  test('foreground router starts share the pending daemon handoff and retry a failed stop', async () => {
    const firstStop = Promise.withResolvers<void>();
    const secondStop = Promise.withResolvers<void>();
    const stopPreviousDaemon = vi
      .fn(() => secondStop.promise)
      .mockReturnValueOnce(firstStop.promise);
    orchestrator = createOrchestrator({}, undefined, stopPreviousDaemon);
    const background = orchestrator.finishDaemonHandoff().catch(error => error);
    const initial = orchestrator.start();
    expect(stopPreviousDaemon).toHaveBeenCalledOnce();
    expect(spawnCalls).toEqual([]);

    const failure = new Error('The previous daemon is still running.');
    firstStop.reject(failure);
    await expect(background).resolves.toBe(failure);
    await expect(initial).resolves.toMatchObject({ status: 'stopped', error: failure.message });
    expect(spawnCalls).toEqual([]);

    const retry = orchestrator.start();
    const concurrent = orchestrator.start();
    expect(stopPreviousDaemon).toHaveBeenCalledTimes(2);
    expect(spawnCalls).toEqual([]);
    secondStop.resolve();
    expect(await Promise.all([retry, concurrent])).toEqual([
      expect.objectContaining({ status: 'running' }),
      expect.objectContaining({ status: 'running' }),
    ]);
    expect(spawnCalls).toHaveLength(1);
  });

  test('quit joins the daemon handoff and prevents a waiting router launch', async () => {
    const pending = Promise.withResolvers<void>();
    orchestrator = createOrchestrator({}, undefined, () => pending.promise);
    const starting = orchestrator.start();
    const stopped = vi.fn();
    const quitting = orchestrator.shutdownForQuit().then(stopped);
    await Promise.resolve();
    expect(stopped).not.toHaveBeenCalled();
    pending.resolve();

    await expect(starting).resolves.toMatchObject({ status: 'stopped' });
    await quitting;
    expect(stopped).toHaveBeenCalledOnce();
    expect(spawnCalls).toEqual([]);
  });

  test('quit cancels the GGUF scan of an admitted model load', async () => {
    await orchestrator.start();
    const scan = Promise.withResolvers<Array<{ name: string; path: string }>>();
    let scanSignal: AbortSignal | undefined;
    mocks.scanLocalModels.mockImplementation((_dir: string, signal?: AbortSignal) => {
      scanSignal = signal;
      signal?.addEventListener('abort', () => scan.reject(signal.reason), { once: true });
      return scan.promise;
    });
    const loading = orchestrator.ensureModel({ model: 'smol' }).catch(error => error);
    await vi.waitFor(() => expect(mocks.scanLocalModels).toHaveBeenCalledOnce());

    await orchestrator.shutdownForQuit();
    scan.resolve([{ name: 'smol', path: '/tmp/llamacpp-router-test-models/smol.gguf' }]);

    expect(await loading).toMatchObject({ message: expect.stringContaining('shutting down') });
    expect(scanSignal?.aborted).toBe(true);
    expect(routerCalls.map(call => call.url)).not.toContain('/models/load');
  });

  test('binds to the requested port when the saved config has not changed', async () => {
    await orchestrator.start();
    const oldUrl = orchestrator.gatewayBaseUrl();
    const newPort = await reservePort();

    await orchestrator.applyConfig({ port: String(newPort) });

    expect(orchestrator.gatewayBaseUrl()).toBe(`http://127.0.0.1:${newPort}/v1`);
    await expect(fetch(`${oldUrl}/models`)).rejects.toThrow();
  });

  test('quit disposes a gateway that finishes rebinding after its router child stops', async () => {
    await orchestrator.start();
    const enteringBind = Promise.withResolvers<void>();
    const releaseBind = Promise.withResolvers<void>();
    const createServer = http.createServer;
    using serverFactory = vi.spyOn(http, 'createServer').mockImplementationOnce((...args) => {
      const server = createServer(...args);
      const listen = server.listen;
      server.listen = ((...listenArgs: unknown[]) => {
        enteringBind.resolve();
        void releaseBind.promise.then(() => Reflect.apply(listen, server, listenArgs));
        return server;
      }) as typeof server.listen;
      return server;
    });
    gatewayPort = await reservePort();
    const applying = orchestrator.applyConfig({ port: String(gatewayPort) }).catch(error => error);
    await enteringBind.promise;

    const quitting = orchestrator.shutdownForQuit();
    try {
      await expect(orchestrator.reconnect()).resolves.toBeNull();
      await vi.waitFor(() => expect(fakeChild.killed).toBe(true));
    } finally {
      releaseBind.resolve();
    }
    await quitting;

    expect(serverFactory).toHaveBeenCalledOnce();
    expect(await applying).toMatchObject({ message: expect.stringContaining('shutting down') });
    expect(orchestrator.gatewayBaseUrl()).toBeNull();
    await expect(fetch(`http://127.0.0.1:${gatewayPort}/v1/models`)).rejects.toThrow();
  });

  test('quit still stops its owned child when graceful model unload stalls', async () => {
    modelStates.set('smol', 'loaded');
    await orchestrator.start();
    const unload = vi
      .spyOn(LlamaCppClient.prototype, 'unloadModel')
      .mockImplementation(() => new Promise(() => {}));

    await orchestrator.shutdownForQuit();

    expect(unload).toHaveBeenCalledExactlyOnceWith('smol', expect.any(Number));
    expect(fakeChild.killed).toBe(true);
    expect(orchestrator.gatewayBaseUrl()).toBeNull();
  });

  test('reconnect observes only an already-ready router and never asks it to reload', async () => {
    await expect(orchestrator.reconnect()).resolves.toBeNull();
    expect(spawnCalls).toHaveLength(0);
    expect(routerCalls).toEqual([]);

    await orchestrator.start();
    routerCalls.length = 0;
    modelStates.set('fresh', 'loaded');
    modelStates.set('unloaded', 'unloaded');

    await expect(orchestrator.reconnect()).resolves.toMatchObject({
      runningModels: [{ name: 'fresh' }],
    });
    expect(routerCalls).toEqual([{ method: 'GET', url: '/models' }]);
  });

  test('a failed probe cannot report an owned router as stopped during reconfiguration', async () => {
    await orchestrator.start();
    const probeError = new Error('Fixture model probe timed out');
    vi.spyOn(LlamaCppClient.prototype, 'listModelsSnapshot').mockRejectedValue(probeError);

    await expect(orchestrator.reconnect()).resolves.toBeNull();
    await expect(orchestrator.reconnect({ requireResponsive: true })).rejects.toBe(probeError);
    expect(spawnCalls).toHaveLength(1);
  });

  test('strict reconnect distinguishes in-progress model processes from ready models', async () => {
    await orchestrator.start();
    modelStates.set('starting', 'loading');
    modelStates.set('finished', 'unloaded');

    await expect(orchestrator.reconnect({ requireResponsive: true })).resolves.toMatchObject({
      runningModels: [],
      modelProcesses: [expect.objectContaining({ modelName: 'starting' })],
    });
  });

  test('reconnect drops a snapshot that completes after quit', async () => {
    await orchestrator.start();
    const snapshot = Promise.withResolvers<LlamaCppModel[]>();
    const read = vi
      .spyOn(LlamaCppClient.prototype, 'listModelsSnapshot')
      .mockReturnValue(snapshot.promise);
    const reading = orchestrator.reconnect();
    expect(read).toHaveBeenCalledExactlyOnceWith(2000);
    await orchestrator.shutdownForQuit();
    snapshot.resolve([]);
    await expect(reading).resolves.toBeNull();
    await expect(orchestrator.reconnect()).resolves.toBeNull();
    expect(read).toHaveBeenCalledOnce();
  });

  test('the gateway /v1/models listing only contains loaded models', async () => {
    modelStates.set('smol', 'loaded');
    modelStates.set('qwen', 'unloaded');
    await orchestrator.start();

    const gatewayUrl = orchestrator.gatewayBaseUrl();
    expect(gatewayUrl).toBeTruthy();
    // gatewayBaseUrl() already includes the /v1 prefix.
    const response = await fetch(`${gatewayUrl}/models`);
    expect(response.ok).toBe(true);
    const payload = (await response.json()) as { data: Array<{ id: string }> };
    expect(payload.data.map(model => model.id)).toEqual(['smol']);
  });

  test('gateway acquireModel loads an unloaded model before the chat request is forwarded', async () => {
    modelStates.set('smol', 'unloaded');
    await orchestrator.start();
    const gatewayUrl = orchestrator.gatewayBaseUrl();

    const response = await fetch(`${gatewayUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'smol', messages: [] }),
    });

    expect(response.ok).toBe(true);
    expect(routerCalls.map(call => call.url)).toContain('/models/load');
    expect(gatewayLeases).toEqual(['smol']);
  });

  test('the gateway stays loopback-only even when the config asks for LAN', async () => {
    const lanOrchestrator = createOrchestrator({
      gatewayAccessMode: 'lan',
      listenHost: '0.0.0.0',
    });
    try {
      await lanOrchestrator.start();
      // The gateway URL is the loopback listener itself.
      expect(lanOrchestrator.gatewayBaseUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
      // A LAN-configured request without a bearer token still reaches the
      // loopback gateway: this listener never authenticates.
      const response = await fetch(`${lanOrchestrator.gatewayBaseUrl()}/models`);
      expect(response.ok).toBe(true);
    } finally {
      await lanOrchestrator.stopService().catch(() => undefined);
    }
  });
});

async function reservePort(): Promise<number> {
  const reservation = net.createServer();
  return await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', () => {
      const port = (reservation.address() as AddressInfo).port;
      reservation.close(error => (error ? reject(error) : resolve(port)));
    });
  });
}

function modelsFixture(
  entries: Array<{ id: string; value: string; failed?: boolean; port?: number }>,
): unknown {
  return {
    data: [
      ...entries.map(entry => ({
        id: entry.id,
        status: {
          value: entry.value === 'failed' ? 'unloaded' : entry.value,
          ...(entry.failed ? { failed: true, exit_code: 1 } : {}),
          args: [
            '--host',
            '127.0.0.1',
            '--port',
            String(entry.port ?? 0),
            '--model',
            `/tmp/llamacpp-router-test-models/${entry.id}.gguf`,
          ],
        },
      })),
      // The synthetic default entry must never reach the app surface.
      { id: 'default', status: { value: 'unloaded', args: ['--port', '0'] } },
    ],
  };
}

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.findIndex(entry => entry.trim() === flag);
  if (index !== -1) return args[index + 1];
  const inline = `${flag}=`;
  const inlineEntry = args.find(entry => entry.trim().startsWith(inline));
  return inlineEntry ? inlineEntry.trim().slice(inline.length) : undefined;
}

/** Minimal ChildProcess stand-in; the fake router serves the spawned port. */
class FakeChildProcess extends EventEmitter {
  readonly pid = 424242;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  stdoutLines: string[] = ['load: spawning server instance with name=smol on port 35021'];

  constructor() {
    super();
    void this.stdout;
    void this.stderr;
  }

  kill(_signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.exitCode = 0;
    queueMicrotask(() => this.emit('exit', 0, null));
    return true;
  }

  /** Emits captured spawn lines so the splitter can attribute them. */
  emitSpawnLines(): void {
    queueMicrotask(() => {
      const text = this.stdoutLines.map(line => `${line}\n`).join('');
      if (text) this.emitStdout(text);
    });
  }

  emitStdout(text: string): void {
    // The orchestrator subscribes to `data` on the stdout stream object.
    (this.stdout as unknown as { emit: (event: string, chunk: Buffer) => void }).emit(
      'data',
      Buffer.from(text),
    );
  }
}
