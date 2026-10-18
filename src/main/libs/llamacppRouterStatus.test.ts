import { describe, expect, test, vi } from 'vitest';

import { LlamaCppClient } from './llamacppClient';
import {
  LLAMACPP_ROUTER_SLOTS_BUSY_UNKNOWN,
  parseLlamaCppRouterModelsPayload,
  parseLlamaCppRouterSlotsPayload,
} from './llamacppRouterStatus';

// Trimmed copies of real llama-server b9244 payloads captured from
// /workspace/review/router/. Entries carry no `path` field; unloaded entries
// report `--port 0` and the synthetic `default` entry's args have no `--model`.
const MODELS_UNLOADED_FIXTURE = {
  object: 'list',
  data: [
    {
      id: 'smol',
      aliases: [],
      tags: [],
      object: 'model',
      owned_by: 'llamacpp',
      created: 1792329826,
      status: {
        value: 'unloaded',
        args: [
          '/workspace/router-lab/llama-b9244/llama-server',
          '--host',
          '127.0.0.1',
          '--port',
          '0',
          '--sleep-idle-seconds',
          '8',
          '--alias',
          'smol',
          '--ctx-size',
          '2048',
          '--device',
          'none',
          '--model',
          '/workspace/router-lab/models/SmolLM2-135M-Instruct-Q4_K_M.gguf',
          '--main-gpu',
          '1',
          '--n-gpu-layers',
          '0',
          '--threads',
          '2',
          '--tensor-split',
          '3,1',
        ],
      },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    },
    {
      id: 'qwen',
      aliases: [],
      tags: [],
      object: 'model',
      owned_by: 'llamacpp',
      created: 1792329826,
      status: {
        value: 'unloaded',
        args: [
          '/workspace/router-lab/llama-b9244/llama-server',
          '--host',
          '127.0.0.1',
          '--port',
          '0',
          '--alias',
          'qwen',
          '--ctx-size',
          '1024',
          '--model',
          '/workspace/router-lab/models/qwen2.5-0.5b-instruct-q4_k_m.gguf',
          '--threads',
          '2',
        ],
      },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    },
    {
      id: 'default',
      aliases: [],
      tags: [],
      object: 'model',
      owned_by: 'llamacpp',
      created: 1792329826,
      status: {
        value: 'unloaded',
        args: [
          '/workspace/router-lab/llama-b9244/llama-server',
          '--host',
          '127.0.0.1',
          '--port',
          '0',
          '--alias',
          'default',
          '--ctx-size',
          '2048',
          '--threads',
          '2',
        ],
      },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    },
  ],
};

const MODELS_SMOL_LOADED_FIXTURE = {
  object: 'list',
  data: [
    MODELS_UNLOADED_FIXTURE.data[1], // qwen stays unloaded
    {
      id: 'smol',
      aliases: [],
      tags: [],
      object: 'model',
      owned_by: 'llamacpp',
      created: 1792329829,
      status: {
        value: 'loaded',
        args: [
          '/workspace/router-lab/llama-b9244/llama-server',
          '--host',
          '127.0.0.1',
          '--port',
          '48447',
          '--sleep-idle-seconds',
          '8',
          '--alias',
          'smol',
          '--ctx-size',
          '2048',
          '--device',
          'none',
          '--model',
          '/workspace/router-lab/models/SmolLM2-135M-Instruct-Q4_K_M.gguf',
          '--main-gpu',
          '1',
          '--n-gpu-layers',
          '0',
          '--threads',
          '2',
          '--tensor-split',
          '3,1',
        ],
      },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      meta: {
        vocab_type: 2,
        n_vocab: 49152,
        n_ctx: 2048,
        n_ctx_train: 8192,
        n_embd: 576,
        n_params: 134515008,
        size: 103668480,
      },
    },
  ],
};

// Real idle /slots response for smol (all four slots idle).
const SLOTS_SMOL_IDLE_FIXTURE = [
  { id: 0, n_ctx: 2048, speculative: false, is_processing: false },
  { id: 1, n_ctx: 2048, speculative: false, is_processing: false },
  { id: 2, n_ctx: 2048, speculative: false, is_processing: false },
  { id: 3, n_ctx: 2048, speculative: false, is_processing: false },
];

test('keeps unloaded models with port 0 and exposes their model path', () => {
  expect(parseLlamaCppRouterModelsPayload(MODELS_UNLOADED_FIXTURE)).toEqual([
    {
      id: 'smol',
      state: 'unloaded',
      modelPath: '/workspace/router-lab/models/SmolLM2-135M-Instruct-Q4_K_M.gguf',
    },
    {
      id: 'qwen',
      state: 'unloaded',
      modelPath: '/workspace/router-lab/models/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    },
    // `default` (no --model in args) is dropped.
  ]);
});

test('reports the real port only for a loaded model', () => {
  expect(parseLlamaCppRouterModelsPayload(MODELS_SMOL_LOADED_FIXTURE)).toEqual([
    {
      id: 'qwen',
      state: 'unloaded',
      modelPath: '/workspace/router-lab/models/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    },
    {
      id: 'smol',
      state: 'loaded',
      modelPath: '/workspace/router-lab/models/SmolLM2-135M-Instruct-Q4_K_M.gguf',
      port: 48447,
    },
  ]);
});

test('failed=true wins over the reported status value and keeps exit code and port', () => {
  expect(
    parseLlamaCppRouterModelsPayload({
      data: [
        {
          id: 'corrupt',
          status: {
            value: 'unloaded',
            args: ['--port', '35021', '--model', '/mdir/corrupt-trunc.gguf'],
            exit_code: 1,
            failed: true,
          },
        },
      ],
    }),
  ).toEqual([
    {
      id: 'corrupt',
      state: 'failed',
      modelPath: '/mdir/corrupt-trunc.gguf',
      exitCode: 1,
      port: 35021,
    },
  ]);
});

test('is tolerant to missing fields, unknown status values, and entries without --model', () => {
  expect(
    parseLlamaCppRouterModelsPayload({
      data: [
        {
          id: 'unknown-state',
          status: { value: 'hibernating', args: ['--model', '/models/a.gguf'] },
        },
        { id: 'no-args-at-all', status: { value: 'loaded' } },
        { id: 'empty-model-arg', status: { value: 'loaded', args: ['--model', '  '] } },
        { id: '', status: { value: 'loaded', args: ['--model', '/models/c.gguf'] } },
        'not-an-object',
      ],
    }),
  ).toEqual([{ id: 'unknown-state', state: 'unloaded', modelPath: '/models/a.gguf' }]);

  expect(parseLlamaCppRouterModelsPayload(null)).toEqual([]);
  expect(parseLlamaCppRouterModelsPayload({})).toEqual([]);
  expect(parseLlamaCppRouterModelsPayload({ data: 'nope' })).toEqual([]);
});

test('reads inline flag syntax and ignores malformed ports', () => {
  expect(
    parseLlamaCppRouterModelsPayload({
      data: [
        {
          id: 'inline',
          status: { value: 'loaded', args: ['--model=/models/a.gguf', '--port=8081'] },
        },
        {
          id: 'malformed-port',
          status: {
            value: 'loaded',
            args: ['--model', '/models/b.gguf', '--port', 'not-a-number'],
          },
        },
      ],
    }),
  ).toEqual([
    { id: 'inline', state: 'loaded', modelPath: '/models/a.gguf', port: 8081 },
    { id: 'malformed-port', state: 'loaded', modelPath: '/models/b.gguf' },
  ]);
});

test('parses /slots idle state from processing slot flags', () => {
  expect(parseLlamaCppRouterSlotsPayload(SLOTS_SMOL_IDLE_FIXTURE)).toEqual({
    busy: false,
    processingSlots: 0,
    totalSlots: 4,
  });

  // Streaming probe shape observed live: is_processing [F,F,F,T].
  expect(
    parseLlamaCppRouterSlotsPayload(
      SLOTS_SMOL_IDLE_FIXTURE.map((slot, index) =>
        index === 3 ? { ...slot, is_processing: true } : slot,
      ),
    ),
  ).toEqual({ busy: true, processingSlots: 1, totalSlots: 4 });
});

test('slots parsing fails safe to busy for non-array payloads', () => {
  expect(parseLlamaCppRouterSlotsPayload({ error: 'model is not loaded' })).toEqual(
    LLAMACPP_ROUTER_SLOTS_BUSY_UNKNOWN,
  );
  expect(parseLlamaCppRouterSlotsPayload(null)).toEqual(LLAMACPP_ROUTER_SLOTS_BUSY_UNKNOWN);
  expect(parseLlamaCppRouterSlotsPayload(undefined)).toEqual(LLAMACPP_ROUTER_SLOTS_BUSY_UNKNOWN);
  // Missing is_processing flags count as slots but never as busy on their own.
  expect(parseLlamaCppRouterSlotsPayload([{ id: 0 }, { id: 1 }])).toEqual({
    busy: false,
    processingSlots: 0,
    totalSlots: 2,
  });
});

describe('LlamaCppClient router helpers', () => {
  test('listRouterModels fetches and parses the real b9244 /models shape', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(MODELS_SMOL_LOADED_FIXTURE));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LlamaCppClient('http://127.0.0.1:18080/');

    await expect(client.listRouterModels(12_000)).resolves.toEqual([
      {
        id: 'qwen',
        state: 'unloaded',
        modelPath: '/workspace/router-lab/models/qwen2.5-0.5b-instruct-q4_k_m.gguf',
      },
      {
        id: 'smol',
        state: 'loaded',
        modelPath: '/workspace/router-lab/models/SmolLM2-135M-Instruct-Q4_K_M.gguf',
        port: 48447,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18080/models',
      expect.objectContaining({ method: 'GET' }),
    );
    vi.unstubAllGlobals();
  });

  test('getModelSlots probes GET /slots?model=X', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(SLOTS_SMOL_IDLE_FIXTURE));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LlamaCppClient('http://127.0.0.1:18080/');

    await expect(client.getModelSlots('smol')).resolves.toEqual({
      busy: false,
      processingSlots: 0,
      totalSlots: 4,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18080/slots?model=smol',
      expect.objectContaining({ method: 'GET' }),
    );
    vi.unstubAllGlobals();
  });

  test('getModelSlots reports busy when the probe fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new LlamaCppClient('http://127.0.0.1:18080/');

    await expect(client.getModelSlots('smol')).resolves.toEqual({
      busy: true,
      processingSlots: 0,
      totalSlots: 0,
    });
    vi.unstubAllGlobals();
  });

  test('getModelSlots encodes the model name', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LlamaCppClient('http://127.0.0.1:18080/');

    await client.getModelSlots('Qwen3.5-0.8B-GGUF/qwen:8b');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18080/slots?model=Qwen3.5-0.8B-GGUF%2Fqwen%3A8b',
      expect.anything(),
    );
    vi.unstubAllGlobals();
  });
});

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}
