import { expect, test } from 'vitest';

import {
  clampRuntimeContextWindow,
  createLlamaCppRuntimeSnapshot,
  createOllamaRuntimeSnapshot,
  ModelCapabilityStatus,
  parseLlamaCppRuntimeCapabilities,
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

test('unverified models default to tool calling support', () => {
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
        },
      ],
    },
  });

  expect(endpoint.contextWindow).toBe(8192);
  expect(endpoint.maxTokens).toBe(1024);
  expect(endpoint.capabilities.toolCalling).toBe(ModelCapabilityStatus.Supported);
  expect(endpoint.capabilities.imageInput).toBe(ModelCapabilityStatus.Unknown);
});

test('Kimi Coding extras use the coding endpoint tool capability while respecting explicit overrides', () => {
  const modelConfig = { id: 'new-coding-model', name: 'New coding model' };
  const coding = resolveModelEndpoint(ProviderName.Moonshot, modelConfig.id, {
    apiFormat: 'openai',
    codingPlanEnabled: true,
    modelConfig,
  });
  expect(coding.protocol).toBe('anthropic');
  expect(coding.capabilities.toolCalling).toBe(ModelCapabilityStatus.Supported);
  const general = resolveModelEndpoint(ProviderName.Moonshot, modelConfig.id, {
    apiFormat: 'anthropic',
    modelConfig,
  });
  expect(general.capabilities.toolCalling).toBe(ModelCapabilityStatus.Unsupported);
  const override = resolveModelEndpoint(ProviderName.Moonshot, modelConfig.id, {
    codingPlanEnabled: true,
    modelConfig: {
      ...modelConfig,
      capabilities: { toolCalling: ModelCapabilityStatus.Unsupported },
    },
  });
  expect(override.capabilities.toolCalling).toBe(ModelCapabilityStatus.Unsupported);
});

test('runtime-detected unsupported tool calling overrides the default', () => {
  const endpoint = resolveModelEndpoint('custom_0', 'my-model', {
    apiFormat: 'openai',
    runtime: {
      kind: 'llamacpp',
      status: 'loaded',
      detectedCapabilities: { toolCalling: ModelCapabilityStatus.Unsupported },
    },
  });

  expect(endpoint.capabilities.toolCalling).toBe(ModelCapabilityStatus.Unsupported);
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

test('configured unknown residue does not clobber the resolved capability', () => {
  // The capability form writes all six keys as unknown by default. A
  // user-added model outside the catalog (deepseek-v4-flash-vision-exp)
  // resolves to endpoint-supported; re-expanding the raw unknown entries
  // must not overwrite that verdict.
  const endpoint = resolveModelEndpoint(ProviderName.DeepSeek, 'deepseek-v4-flash-vision-exp', {
    providerConfig: {
      apiKey: 'key',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai',
      models: [
        {
          id: 'deepseek-v4-flash-vision-exp',
          name: 'DeepSeek V4 Flash Vision Exp',
          supportsImage: true,
          capabilities: {
            toolCalling: ModelCapabilityStatus.Unknown,
            imageInput: ModelCapabilityStatus.Unknown,
            reasoning: ModelCapabilityStatus.Unknown,
          },
        },
      ],
    },
  });

  expect(endpoint.capabilities.toolCalling).toBe(ModelCapabilityStatus.Supported);
  expect(endpoint.capabilities.imageInput).toBe(ModelCapabilityStatus.Supported);
});

test('explicit unsupported user capability still wins in the endpoint layer', () => {
  const endpoint = resolveModelEndpoint(ProviderName.DeepSeek, 'deepseek-v4-flash-vision-exp', {
    providerConfig: {
      apiKey: 'key',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai',
      models: [
        {
          id: 'deepseek-v4-flash-vision-exp',
          name: 'DeepSeek V4 Flash Vision Exp',
          capabilities: { toolCalling: ModelCapabilityStatus.Unsupported },
        },
      ],
    },
  });

  expect(endpoint.capabilities.toolCalling).toBe(ModelCapabilityStatus.Unsupported);
});

test('derived supportsImage false preserves an unstated image capability', () => {
  // Settings always persists supportsImage (unstated -> false). The
  // endpoint layer must not convert that derived false into an explicit
  // Unsupported, or the three-state capability selector's unknown state
  // is lost on reload.
  const endpoint = resolveModelEndpoint(ProviderName.DeepSeek, 'deepseek-v4-flash-vision-exp', {
    providerConfig: {
      apiKey: 'key',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai',
      models: [
        {
          id: 'deepseek-v4-flash-vision-exp',
          name: 'DeepSeek V4 Flash Vision Exp',
          supportsImage: false,
          capabilities: {
            imageInput: ModelCapabilityStatus.Unknown,
          },
        },
      ],
    },
  });

  expect(endpoint.capabilities.imageInput).toBe(ModelCapabilityStatus.Unknown);
});

test('model entry baseUrl surfaces as modelBaseUrl without affecting baseUrl resolution', () => {
  const endpoint = resolveModelEndpoint('custom_enterprise', 'bench-anthropic', {
    providerConfig: {
      apiKey: 'key',
      baseUrl: 'https://gateway.example.test/v1',
      apiFormat: 'anthropic',
      models: [
        {
          id: 'bench-anthropic',
          name: 'Bench Anthropic',
          baseUrl: 'https://gateway.example.test/bench-anthropic',
        },
      ],
    },
  });

  expect(endpoint.baseUrl).toBe('https://gateway.example.test/v1');
  expect(endpoint.modelBaseUrl).toBe('https://gateway.example.test/bench-anthropic');
});

test('models without a baseUrl omit modelBaseUrl and keep the provider baseUrl', () => {
  const endpoint = resolveModelEndpoint('custom_enterprise', 'bench-anthropic', {
    providerConfig: {
      apiKey: 'key',
      baseUrl: 'https://gateway.example.test/v1',
      apiFormat: 'anthropic',
      models: [{ id: 'bench-anthropic', name: 'Bench Anthropic' }],
    },
  });

  expect(endpoint.baseUrl).toBe('https://gateway.example.test/v1');
  expect(endpoint.modelBaseUrl).toBeUndefined();
});

test('an explicit baseUrl override still wins while modelBaseUrl surfaces the model entry', () => {
  const endpoint = resolveModelEndpoint('custom_enterprise', 'bench-anthropic', {
    baseUrl: 'https://override.example.test/v1',
    providerConfig: {
      apiKey: 'key',
      baseUrl: 'https://gateway.example.test/v1',
      apiFormat: 'anthropic',
      models: [
        {
          id: 'bench-anthropic',
          name: 'Bench Anthropic',
          baseUrl: 'https://gateway.example.test/bench-anthropic',
        },
      ],
    },
  });

  expect(endpoint.baseUrl).toBe('https://override.example.test/v1');
  expect(endpoint.modelBaseUrl).toBe('https://gateway.example.test/bench-anthropic');
});

test('llama.cpp runtime capabilities map declared modalities', () => {
  expect(
    parseLlamaCppRuntimeCapabilities({
      modalities: { vision: true, video: true, audio: false },
      chat_template_caps: { supports_tools: true },
    }),
  ).toEqual({
    toolCalling: ModelCapabilityStatus.Supported,
    imageInput: ModelCapabilityStatus.Supported,
    videoInput: ModelCapabilityStatus.Supported,
    audioInput: ModelCapabilityStatus.Unsupported,
  });

  expect(parseLlamaCppRuntimeCapabilities({ modalities: { vision: false } })).toEqual({
    imageInput: ModelCapabilityStatus.Unsupported,
  });
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
