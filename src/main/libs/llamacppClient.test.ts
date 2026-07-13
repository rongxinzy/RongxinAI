import { afterEach, describe, expect, test, vi } from 'vitest';

import { LlamaCppClient } from './llamacppClient';

describe('LlamaCppClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('lists local models from router /models endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      data: [{
        id: 'qwen3:8b',
        path: '/models/qwen3.gguf',
        meta: { size: 123, n_params: 8_000_000_000, n_ctx_train: 32768 },
        status: { value: 'loaded', args: ['--ctx-size', '4096'] },
      }],
    })));

    const client = new LlamaCppClient('http://127.0.0.1:8080/');

    await expect(client.listModels()).resolves.toEqual([expect.objectContaining({
      name: 'qwen3:8b',
      path: '/models/qwen3.gguf',
      size: 123,
      status: 'loaded',
      trained_context_length: 32768,
      runtime_context_length: 4096,
      details: expect.objectContaining({
        parameter_size: '8B',
        context_length: 32768,
      }),
    })]);
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/models?reload=1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  test('throws on HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => '{"error":"model not found"}',
    } as Response)));
    const client = new LlamaCppClient();

    await expect(client.loadModel({ model: 'missing' })).rejects.toThrow('HTTP 404');
  });

  test('waits for the target model to become ready after requesting a load', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/models/load')) return jsonResponse({});
      return jsonResponse({
        data: [{
          id: 'qwen3:8b',
          status: { value: 'error' },
        }],
      });
    }));
    const client = new LlamaCppClient();

    await expect(client.loadModel({ model: 'qwen3:8b' })).rejects.toThrow(
      'llama.cpp could not load model qwen3:8b',
    );
  });

  test('waits for a loading model to become ready by its file name', async () => {
    let modelListRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/models/load') || url.endsWith('/v1/chat/completions')) {
        return jsonResponse({});
      }
      modelListRequests += 1;
      return jsonResponse({
        data: [{
          id: '/models/qwen3.gguf',
          status: { value: modelListRequests === 1 ? 'loading' : 'loaded' },
        }],
      });
    }));
    const client = new LlamaCppClient();

    await expect(client.loadModel({ model: 'qwen3.gguf' })).resolves.toEqual({
      success: true,
      runningModels: [expect.objectContaining({ name: '/models/qwen3.gguf', status: 'loaded' })],
    });
  });

  test('unloads the model when the inference probe fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/models/load') || url.endsWith('/models/unload')) return jsonResponse({});
      if (url.endsWith('/v1/chat/completions')) {
        return {
          ok: false,
          status: 500,
          text: async () => 'inference failed',
        } as Response;
      }
      return jsonResponse({
        data: [{
          id: 'qwen3:8b',
          status: { value: 'loaded' },
        }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new LlamaCppClient();

    await expect(client.loadModel({ model: 'qwen3:8b' })).rejects.toThrow('HTTP 500');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/models/unload',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('falls back to cached launch context when router args do not expose runtime ctx-size', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/models/load')) {
        return jsonResponse({});
      }
      return jsonResponse({
        data: [{
          id: 'qwen3:8b',
          path: '/models/qwen3.gguf',
          meta: { size: 123, n_params: 8_000_000_000, n_ctx_train: 32768 },
          status: { value: 'loaded', args: ['--threads', '8'] },
        }],
      });
    }));

    const client = new LlamaCppClient('http://127.0.0.1:8080/');

    await expect(client.loadModel({
      model: 'qwen3:8b',
      options: { ctxSize: 8192 },
    })).resolves.toEqual({
      success: true,
      runningModels: [
        expect.objectContaining({
          name: 'qwen3:8b',
          trained_context_length: 32768,
          runtime_context_length: 8192,
        }),
      ],
    });
  });

  test('uses the configured load timeout for router model discovery and model load calls', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/models/load')) {
        return jsonResponse({});
      }
      return jsonResponse({
        data: [{
          id: 'qwen3:8b',
          path: '/models/qwen3.gguf',
          meta: { size: 123, n_params: 8_000_000_000, n_ctx_train: 32768 },
          status: { value: 'loaded', args: ['--ctx-size', '4096'] },
        }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new LlamaCppClient('http://127.0.0.1:8080/', {
      loadTimeoutMs: 123_000,
    });

    await client.listModels();
    await client.loadModel({ model: 'qwen3:8b' });

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 123_000);
    expect(timeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      10_000,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'qwen3:8b',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      }),
    );
  });
});

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}
