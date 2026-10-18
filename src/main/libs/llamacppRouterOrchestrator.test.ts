import http from 'node:http';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  classifyLlamaCppModelLoadError,
  LlamaCppModelLoadFailureReason,
} from './llamacppModelLoadErrors';
import type { LlamaCppServiceConfig } from '../../shared/llamacpp';
import { LlamaCppOrchestrator } from '../../shared/llamacpp';
import { LlamaCppRouterOrchestrator } from './llamacppRouterOrchestrator';
import { buildLlamaCppRouterProcessArgs } from './llamacppRouterProcess';

vi.mock('./llamacppRuntimePaths', async importOriginal => ({
  ...(await importOriginal<typeof import('./llamacppRuntimePaths')>()),
  findLlamaCppExecutable: async () => '/fake/llama-server',
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
  let routerServer: http.Server | null = null;
  let gatewayPort = 0;
  let routerCalls: Array<{ method: string; url: string }>;
  let loadHandler: (model: string) => void;
  let unloadHandler: (model: string) => void;
  let fakeChild: FakeChildProcess;
  let spawnCalls: Array<{ command: string; args: string[] }>;
  let orchestrator: LlamaCppRouterOrchestrator;
  /** model name -> router status value; drives the fake /models payload. */
  let modelStates: Map<string, string>;

  beforeEach(() => {
    routerCalls = [];
    spawnCalls = [];
    modelStates = new Map();
    loadHandler = model => {
      modelStates.set(model, 'loaded');
    };
    unloadHandler = model => {
      modelStates.set(model, 'unloaded');
    };
    fakeChild = new FakeChildProcess();

    // Reserve an ephemeral port for the gateway so its listener never collides
    // with the fake router or the default 8080, then release it for binding.
    const gatewayReservation = net.createServer();
    gatewayPort = 0;
    void new Promise<void>(resolve => {
      gatewayReservation.listen(0, '127.0.0.1', () => {
        gatewayPort = (gatewayReservation.address() as AddressInfo).port;
        gatewayReservation.close(() => resolve());
      });
    });

    orchestrator = createOrchestrator();
  });

  afterEach(async () => {
    await orchestrator?.stopService().catch(() => undefined);
    await closeRouterServer();
  });

  function createOrchestrator(
    serviceConfig: Partial<LlamaCppServiceConfig> = {},
  ): LlamaCppRouterOrchestrator {
    return new LlamaCppRouterOrchestrator({
      userDataPath: '/tmp/llamacpp-router-test-user-data',
      getStore: () => makeStore(),
      getServiceConfig: () => ({
        port: String(gatewayPort),
        orchestrator: LlamaCppOrchestrator.Router,
        ...serviceConfig,
      }),
      getModelsDir: () => '/tmp/llamacpp-router-test-models',
      getPresetPath: () => '/tmp/llamacpp-router-test-user-data/llamacpp/models-preset.ini',
      spawnProcess: (command, args) => {
        spawnCalls.push({ command, args });
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
                ...(value === 'loaded' ? { port: 35021 } : {}),
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
    await orchestrator.status();

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

  test('loads a model through preset reload + POST /models/load and reports it running', async () => {
    modelStates.set('smol', 'unloaded');

    const status = await orchestrator.ensureModel({
      model: 'smol',
      modelPath: '/tmp/llamacpp-router-test-models/smol.gguf',
      options: { ctxSize: 2048 },
    });

    expect(status.status.status).toBe('running');
    expect(status.runningModels.map(model => model.name)).toEqual(['smol']);
    const urls = routerCalls.map(call => call.url);
    expect(urls).toContain('/models?reload=1');
    expect(urls).toContain('/models/load');
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
    await orchestrator.status(); // starts router + gateway, caches running models

    const status = await orchestrator.stopModel('smol');

    expect(unloadedModels).toEqual(['smol']);
    expect(routerCalls.some(call => call.url === '/models/unload')).toBe(true);
    expect(status.runningModels.map(model => model.name)).toEqual([]);
  });

  test('shutdownForQuit unloads every loaded model, stops the gateway and kills the router', async () => {
    modelStates.set('smol', 'loaded');
    modelStates.set('qwen', 'loaded');
    const unloadedModels: string[] = [];
    unloadHandler = model => {
      unloadedModels.push(model);
      modelStates.set(model, 'unloaded');
    };
    await orchestrator.status(); // starts router + gateway

    await orchestrator.shutdownForQuit();

    expect(unloadedModels.sort()).toEqual(['qwen', 'smol']);
    expect(fakeChild.killed).toBe(true);
    expect(orchestrator.gatewayBaseUrl()).toBeNull();
  });

  test('the gateway /v1/models listing only contains loaded models', async () => {
    modelStates.set('smol', 'loaded');
    modelStates.set('qwen', 'unloaded');
    await orchestrator.status();

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
    await orchestrator.status();
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
});

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

  kill(): boolean {
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
