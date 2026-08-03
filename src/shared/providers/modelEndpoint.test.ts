import { expect, test } from 'vitest';

import {
  clampRuntimeContextWindow,
  createLlamaCppRuntimeSnapshot,
  createOllamaRuntimeSnapshot,
  ModelCapabilityStatus,
  ProviderName,
  resolveModelEndpoint,
} from './index';

test('resolves aliases to the registry canonical model and keeps registry metadata', () => {
  const endpoint = resolveModelEndpoint(ProviderName.Moonshot, 'KIMI-K3', {
    providerConfig: {
      apiKey: 'key',
      baseUrl: 'https://example.test/v1',
      models: [],
    },
  });

  expect(endpoint.modelId).toBe('kimi-k3');
  expect(endpoint.contextWindow).toBe(1_000_000);
  expect(endpoint.apiKey).toBe('key');
});

test('resolves the GPT-5.6 family without custom capacity fields', () => {
  const sol = resolveModelEndpoint(ProviderName.OpenAI, 'gpt-5.6');
  const luna = resolveModelEndpoint(ProviderName.OpenAI, 'gpt-5.6-luna');

  expect(sol).toMatchObject({
    modelId: 'gpt-5.6-sol',
    contextWindow: 1_050_000,
    maxTokens: 128_000,
  });
  expect(luna).toMatchObject({
    modelId: 'gpt-5.6-luna',
    contextWindow: 1_050_000,
    maxTokens: 128_000,
  });
  expect(sol.capabilities).toMatchObject({
    toolCalling: ModelCapabilityStatus.Supported,
    imageInput: ModelCapabilityStatus.Supported,
    reasoning: ModelCapabilityStatus.Supported,
  });
});

test('includes verified registry capability facts used by Work', () => {
  const kimi = resolveModelEndpoint(ProviderName.Moonshot, 'kimi-k3', {
    apiFormat: 'openai',
  });
  expect(kimi.capabilities.toolCalling).toBe(ModelCapabilityStatus.Supported);
  expect(kimi.capabilities.reasoning).toBe(ModelCapabilityStatus.Supported);

  const coder = resolveModelEndpoint(ProviderName.Qwen, 'qwen3-coder-next', {
    apiFormat: 'openai',
  });
  expect(coder.capabilities.toolCalling).toBe(ModelCapabilityStatus.Supported);
  expect(coder.capabilities.reasoning).toBe(ModelCapabilityStatus.Supported);
});

test('unknown models remain configurable and conservative', () => {
  const endpoint = resolveModelEndpoint('custom_0', 'my-model', {
    providerConfig: {
      apiKey: 'key',
      baseUrl: 'https://example.test/v1',
      apiFormat: 'openai',
      models: [
        {
          id: 'my-model',
          name: 'My Model',
          contextWindow: 8192,
          maxTokens: 1024,
          capabilities: { toolCalling: ModelCapabilityStatus.Supported },
        },
      ],
    },
  });

  expect(endpoint.contextWindow).toBe(8192);
  expect(endpoint.maxTokens).toBe(1024);
  expect(endpoint.capabilities.toolCalling).toBe(ModelCapabilityStatus.Supported);
  expect(endpoint.capabilities.imageInput).toBe(ModelCapabilityStatus.Unknown);
});

test('explicit metadata wins over runtime and registry values', () => {
  const endpoint = resolveModelEndpoint(ProviderName.Moonshot, 'kimi-k3', {
    providerConfig: {
      apiKey: 'key',
      baseUrl: 'https://example.test/v1',
      models: [
        {
          id: 'kimi-k3',
          name: 'Override',
          contextWindow: 12_000,
          maxTokens: 900,
          capabilities: { imageInput: ModelCapabilityStatus.Unsupported },
        },
      ],
    },
    runtime: {
      kind: 'llamacpp',
      status: 'loaded',
      runtimeContextWindow: 32_000,
      trainedContextWindow: 16_000,
      detectedCapabilities: { imageInput: ModelCapabilityStatus.Supported },
    },
  });

  expect(endpoint.contextWindow).toBe(12_000);
  expect(endpoint.maxTokens).toBe(900);
  expect(endpoint.capabilities.imageInput).toBe(ModelCapabilityStatus.Unsupported);
});

test('runtime context never exceeds trained context', () => {
  expect(clampRuntimeContextWindow(32_000, 16_000)).toBe(16_000);
  expect(clampRuntimeContextWindow(8_000, 16_000)).toBe(8_000);
});

test('local runtime adapters expose loaded state and detected metadata', () => {
  expect(
    createOllamaRuntimeSnapshot({
      serviceStatus: 'running',
      showModel: { capabilities: ['completion'] },
    }).detectedCapabilities?.toolCalling,
  ).not.toBe(ModelCapabilityStatus.Supported);

  expect(
    createOllamaRuntimeSnapshot({
      serviceStatus: 'running',
      modelId: 'qwen3:8b',
      runningModel: { name: 'qwen3:8b', context_length: 8192 },
      showModel: { capabilities: ['vision', 'thinking'] },
    }),
  ).toMatchObject({
    kind: 'ollama',
    status: 'loaded',
    runtimeContextWindow: 8192,
    detectedCapabilities: {
      imageInput: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
  });

  expect(
    createLlamaCppRuntimeSnapshot({
      serviceStatus: 'running',
      model: {
        name: 'local',
        status: 'loaded',
        runtime_context_length: 4096,
        trained_context_length: 8192,
      },
    }),
  ).toMatchObject({
    kind: 'llamacpp',
    status: 'loaded',
    runtimeContextWindow: 4096,
    trainedContextWindow: 8192,
  });
});
