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
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ 'Content-Type': 'application/json' }) }),
    );
  });

  test('streams chat chunks from OpenAI-compatible SSE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      { choices: [{ delta: { reasoning_content: 'thinking' } }] },
      { choices: [{ delta: { content: 'hi' } }] },
      { choices: [{ finish_reason: 'stop' }], usage: { completion_tokens: 1 }, timings: { predicted_per_second: 12.5 } },
      '[DONE]',
    ])));
    const chunks: unknown[] = [];
    const client = new LlamaCppClient();

    await client.chat({
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    }, (chunk) => chunks.push(chunk));

    expect(chunks).toEqual([
      expect.objectContaining({ message: expect.objectContaining({ thinking: 'thinking' }), done: false }),
      expect.objectContaining({ message: expect.objectContaining({ content: 'hi' }), done: false }),
      expect.objectContaining({ done: true, eval_count: 1, predicted_per_second: 12.5 }),
    ]);
  });

  test('maps num_predict to OpenAI-compatible max_tokens', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      model: 'qwen3:8b',
      choices: [{ message: { content: 'ok' } }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LlamaCppClient();

    await client.chat({
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
      options: {
        temperature: 0.4,
        num_predict: 256,
      },
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody.max_tokens).toBe(256);
    expect(requestBody.num_predict).toBeUndefined();
  });

  test('keeps final usage metrics when the stream ends with a bare done marker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      { choices: [{ delta: { content: 'hi' } }] },
      {
        choices: [{ finish_reason: 'stop' }],
        usage: { completion_tokens: 3 },
        timings: { predicted_n: 3, predicted_per_second: 18.25 },
      },
      '[DONE]',
    ])));
    let finalChunk;
    const client = new LlamaCppClient();

    await client.chat({
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    }, (chunk) => {
      if (chunk.done) finalChunk = chunk;
    });

    expect(finalChunk).toEqual(expect.objectContaining({
      eval_count: 3,
      predicted_per_second: 18.25,
    }));
  });

  test('maps timings-only metrics chunks from OpenAI-compatible SSE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      { choices: [{ delta: { content: 'hi' } }] },
      {
        timings: { prompt_n: 4, predicted_n: 6, predicted_per_second: 12 },
      },
      '[DONE]',
    ])));
    const chunks: unknown[] = [];
    const client = new LlamaCppClient();

    await client.chat({
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    }, (chunk) => chunks.push(chunk));

    expect(chunks).toContainEqual(expect.objectContaining({
      prompt_eval_count: 4,
      eval_count: 6,
      predicted_per_second: 12,
      timings: expect.objectContaining({ prompt_n: 4 }),
    }));
  });

  test('cancels the SSE reader when chat generation is aborted', async () => {
    let cancelled = false;
    const fetchMock = vi.fn(async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
        },
        cancel() {
          cancelled = true;
        },
      });
      return {
        ok: true,
        status: 200,
        body,
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const abortController = new AbortController();
    const client = new LlamaCppClient();
    let seenFirstChunk = false;

    const result = client.chat({
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    }, () => {
      seenFirstChunk = true;
      abortController.abort(new Error('Generation cancelled'));
    }, { signal: abortController.signal });

    await expect(Promise.race([
      result.then(() => 'resolved', (error) => error instanceof Error ? error.message : String(error)),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 50)),
    ])).resolves.not.toBe('timeout');
    expect(seenFirstChunk).toBe(true);
    expect(cancelled).toBe(true);
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

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 123_000);
  });
});

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

function sseResponse(chunks: Array<Record<string, unknown> | '[DONE]'>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const frames = chunks.map((chunk) => `data: ${chunk === '[DONE]' ? chunk : JSON.stringify(chunk)}\n\n`);
      controller.enqueue(encoder.encode(frames.join('')));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    body,
  } as Response;
}
