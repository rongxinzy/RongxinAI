import { describe, expect, it } from 'vitest';

import { extractDiscoveredModelContextWindow, probeProviderEndpoint } from './providerTest';

describe('probeProviderEndpoint', () => {
  it('extracts per-model context windows reported by OpenAI-compatible servers', async () => {
    const fetchMock = async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'vllm-qwen3', max_model_len: 65536 },
            { id: 'ollama-r1', context_length: 32768 },
            { id: 'nested-openrouter', top_provider: { context_length: 131072 } },
            { id: 'bare-openai', object: 'model' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );

    const result = await probeProviderEndpoint(
      'http://172.18.5.188:3000/v1',
      'openai-completions',
      'sk-test',
      fetchMock as unknown as typeof fetch,
    );

    expect(result).toMatchObject({
      ok: true,
      modelCount: 4,
      discoveredModels: ['vllm-qwen3', 'ollama-r1', 'nested-openrouter', 'bare-openai'],
      discoveredModelContexts: {
        'vllm-qwen3': 65536,
        'ollama-r1': 32768,
        'nested-openrouter': 131072,
      },
    });
  });

  it('ignores non-positive or unbounded context lengths when probing', () => {
    expect(extractDiscoveredModelContextWindow({ max_model_len: 0 })).toBeUndefined();
    expect(extractDiscoveredModelContextWindow({ context_window: -1 })).toBeUndefined();
    expect(
      extractDiscoveredModelContextWindow({ context_length: Number.POSITIVE_INFINITY }),
    ).toBeUndefined();
    expect(extractDiscoveredModelContextWindow({ n_ctx: 16384 })).toBe(16384);
  });
});
