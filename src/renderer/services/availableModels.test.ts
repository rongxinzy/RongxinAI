import { afterEach, expect, test, vi } from 'vitest';

import {
  createProviderConnectionTestSignature,
  ProviderModelConnectionFailureKind,
  ProviderModelConnectionTestStatus,
  ModelCapabilityStatus,
  ProviderName,
} from '../../shared/providers';
import { ManagedProviderAccessMode } from '../../shared/managedProviders';
import type { AppConfig } from '../config';
import { defaultConfig } from '../config';
import {
  buildConfiguredAvailableModels,
  buildLlamaCppRunningModels,
  collectAvailableModels,
} from './availableModels';

function createConfig(): AppConfig {
  return {
    ...defaultConfig,
    api: { ...defaultConfig.api },
    model: {
      ...defaultConfig.model,
      availableModels: [...defaultConfig.model.availableModels],
    },
    providers: {
      ...(defaultConfig.providers ?? {}),
      [ProviderName.DeepSeek]: {
        enabled: true,
        apiKey: 'sk-test',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiFormat: 'anthropic',
        models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', supportsImage: false }],
      },
      [ProviderName.LlamaCpp]: {
        enabled: false,
        userEnabled: false,
        apiKey: '',
        baseUrl: 'http://127.0.0.1:8080/v1',
        apiFormat: 'openai',
        models: [{ id: 'qwen-local', name: 'qwen-local', supportsImage: false }],
      },
    },
  };
}

async function markProviderModelTestSuccess(
  config: AppConfig,
  providerKey: string,
  modelId: string,
): Promise<void> {
  const providerConfig = config.providers?.[providerKey];
  const model = providerConfig?.models?.find(item => item.id === modelId);
  if (!providerConfig || !model) throw new Error(`Model ${providerKey}::${modelId} is not configured`);
  const signature = await createProviderConnectionTestSignature({
    providerId: providerKey,
    baseUrl: providerConfig.baseUrl,
    apiFormat: providerConfig.apiFormat ?? 'anthropic',
    provider: providerConfig,
  });
  model.connectionTest = {
    status: ProviderModelConnectionTestStatus.Success,
    signature,
    testedAt: 1,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('collectAvailableModels exposes running llama.cpp models when provider is disabled', async () => {
  const listRunningModels = vi.fn(async () => [
    { name: 'qwen-local', runtime_context_length: 8192 },
  ]);
  vi.stubGlobal('window', {
    electron: {
      llamacpp: {
        listRunningModels,
      },
    },
  });

  const models = await collectAvailableModels(createConfig());

  expect(listRunningModels).toHaveBeenCalledTimes(1);
  expect(models.some(model => model.providerKey === ProviderName.LlamaCpp)).toBe(true);
  expect(models.some(model => model.providerKey === ProviderName.DeepSeek)).toBe(false);
});

test('exposes the managed free model only when the account is entitled to it', async () => {
  vi.stubGlobal('window', {
    electron: {
      modelPool: {
        listModels: vi.fn(async () => ({
          ok: true,
          status: 200,
          models: ['zhiyuan-free'],
        })),
      },
      llamacpp: { listRunningModels: vi.fn(async () => []) },
    },
  });

  const models = await collectAvailableModels(createConfig());

  expect(models[0]).toMatchObject({
    id: 'zhiyuan-free',
    providerKey: ProviderName.Zhiyuan,
  });
});

test('does not expose the managed free model when the account has no entitlement', async () => {
  vi.stubGlobal('window', {
    electron: {
      modelPool: {
        listModels: vi.fn(async () => ({ ok: true, status: 200, models: [] })),
      },
      llamacpp: { listRunningModels: vi.fn(async () => []) },
    },
  });

  const models = await collectAvailableModels(createConfig());

  expect(models.some(model => model.providerKey === ProviderName.Zhiyuan)).toBe(false);
  expect(models.some(model => model.providerKey === ProviderName.DeepSeek)).toBe(false);
});

test('exclusive managed policy exposes only the synchronized custom provider', async () => {
  const config = createConfig();
  config.providers = {
    ...config.providers,
    custom_enterprise: {
      enabled: true,
      apiKey: 'managed-token',
      baseUrl: 'http://127.0.0.1:8090/v1',
      apiFormat: 'openai',
      displayName: 'Zhiyuan',
      models: [{ id: 'enterprise-chat', name: 'Enterprise Chat' }],
    },
  };
  await markProviderModelTestSuccess(config, 'custom_enterprise', 'enterprise-chat');
  const listRunningModels = vi.fn(async () => [{ name: 'qwen-local' }]);
  vi.stubGlobal('window', {
    electron: {
      managedProviders: {
        policy: vi.fn(async () => ({
          mode: ManagedProviderAccessMode.Exclusive,
          providerKeys: ['custom_enterprise'],
        })),
      },
      llamacpp: { listRunningModels },
    },
  });

  await expect(collectAvailableModels(config)).resolves.toEqual([
    expect.objectContaining({ id: 'enterprise-chat', providerKey: 'custom_enterprise' }),
  ]);
  expect(listRunningModels).not.toHaveBeenCalled();
});

test('does not expose the legacy default model when no provider is configured', async () => {
  const config = createConfig();
  config.providers = Object.fromEntries(
    Object.entries(config.providers ?? {}).map(([provider, providerConfig]) => [
      provider,
      { ...providerConfig, enabled: false, apiKey: '', models: [] },
    ]),
  );
  vi.stubGlobal('window', {
    electron: {
      llamacpp: { listRunningModels: vi.fn(async () => []) },
    },
  });

  await expect(collectAvailableModels(config)).resolves.toEqual([]);
});

test('collectAvailableModels merges running llama.cpp model metadata', async () => {
  const listRunningModels = vi.fn(async () => [
    {
      name: 'qwen-local',
      runtime_context_length: 8192,
      trained_context_length: 32768,
      supportsThinkingToggle: true,
    },
  ]);
  vi.stubGlobal('window', {
    electron: {
      llamacpp: {
        listRunningModels,
      },
    },
  });
  const config = createConfig();
  if (config.providers) {
    config.providers[ProviderName.LlamaCpp] = {
      ...config.providers[ProviderName.LlamaCpp],
      enabled: true,
      userEnabled: true,
    };
  }

  const models = await collectAvailableModels(config);

  expect(listRunningModels).toHaveBeenCalledTimes(1);
  const llamaCppModel = models.find(
    model => model.providerKey === ProviderName.LlamaCpp && model.id === 'qwen-local',
  );
  expect(llamaCppModel).toBeDefined();
  expect(llamaCppModel?.llamaCppAgentEligibility).toMatchObject({
    eligible: false,
    runtimeContextWindow: 8192,
    trainedContextWindow: 32768,
  });
  expect(llamaCppModel?.supportsThinkingToggle).toBe(true);
});

test('uses saved llama.cpp preferences for the model capability metadata', () => {
  const models = buildLlamaCppRunningModels(
    [{ name: 'qwen-local', runtime_context_length: 8192 }],
    {
      'qwen-local': {
        ctxSize: 65_536,
        maxTokens: 8192,
        capabilities: {
          toolCalling: ModelCapabilityStatus.Supported,
          imageInput: ModelCapabilityStatus.Unsupported,
          reasoning: ModelCapabilityStatus.Supported,
        },
      },
    },
  );

  expect(models).toEqual([
    expect.objectContaining({
      id: 'qwen-local',
      maxTokens: 8192,
      llamaCppRuntimeContextWindow: 65_536,
      capabilities: {
        toolCalling: ModelCapabilityStatus.Supported,
        imageInput: ModelCapabilityStatus.Unsupported,
        reasoning: ModelCapabilityStatus.Supported,
      },
    }),
  ]);
});

test('preserves contextTokens for custom cloud models', () => {
  const config = createConfig();
  config.providers = {
    custom_usage: {
      enabled: true,
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      apiFormat: 'openai',
      models: [
        {
          id: 'custom-cloud-model',
          name: 'Custom Cloud Model',
          contextTokens: 131_072,
        },
      ],
    },
  };

  const model = buildConfiguredAvailableModels(config).find(
    item => item.id === 'custom-cloud-model',
  );

  expect(model?.contextWindow).toBe(131_072);
});

test('uses repaired provider metadata consistently for image flags and capabilities', () => {
  const config = createConfig();
  config.providers = {
    [ProviderName.Qwen]: {
      enabled: true,
      apiKey: 'test-key',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiFormat: 'openai',
      // Simulate a stale saved config from before qwen3.6-plus gained image metadata.
      models: [{ id: 'qwen3.6-plus', name: 'Qwen3.6 Plus', supportsImage: false }],
    },
  };

  const model = buildConfiguredAvailableModels(config)[0];

  expect(model.supportsImage).toBe(true);
  expect(model.capabilities?.imageInput).toBe(ModelCapabilityStatus.Supported);
});

test('uses the canonical coding-plan catalog instead of stale saved provider models', () => {
  const config = createConfig();
  config.providers = {
    [ProviderName.Moonshot]: {
      enabled: true,
      apiKey: 'test-key',
      baseUrl: 'https://api.moonshot.cn/v1',
      apiFormat: 'openai',
      codingPlanEnabled: true,
      // Reproduce a legacy config where the Settings view and chat picker diverged.
      models: [
        { id: 'kimi-k2.6', name: 'Kimi K2.6', supportsImage: true },
        { id: 'kimi-for-coding', name: 'Kimi K2.5', supportsImage: true },
      ],
    },
  };

  const models = buildConfiguredAvailableModels(config);

  expect(models.map(model => [model.id, model.name])).toEqual([
    ['kimi-for-coding', 'Kimi for Coding'],
  ]);
});

test('shows a provider model only after a current successful connection test', async () => {
  const config = createConfig();
  vi.stubGlobal('window', {
    electron: {
      llamacpp: { listRunningModels: vi.fn(async () => []) },
    },
  });

  const untestedModels = await collectAvailableModels(config);
  expect(
    untestedModels.some(
      model => model.providerKey === ProviderName.DeepSeek && model.id === 'deepseek-chat',
    ),
  ).toBe(false);

  await markProviderModelTestSuccess(config, ProviderName.DeepSeek, 'deepseek-chat');
  const testedModels = await collectAvailableModels(config);
  expect(
    testedModels.some(
      model => model.providerKey === ProviderName.DeepSeek && model.id === 'deepseek-chat',
    ),
  ).toBe(true);
});

test('hides a current failed connection test', async () => {
  const config = createConfig();
  const deepSeekConfig = config.providers![ProviderName.DeepSeek];
  const signature = await createProviderConnectionTestSignature({
    providerId: ProviderName.DeepSeek,
    baseUrl: deepSeekConfig.baseUrl,
    apiFormat: 'anthropic',
    provider: deepSeekConfig,
  });
  deepSeekConfig.models![0].connectionTest = {
    status: ProviderModelConnectionTestStatus.Failure,
    signature,
    failureKind: ProviderModelConnectionFailureKind.Model,
    testedAt: 1,
  };

  vi.stubGlobal('window', {
    electron: {
      llamacpp: { listRunningModels: vi.fn(async () => [{ name: 'qwen-local' }]) },
    },
  });

  const models = await collectAvailableModels(config);
  expect(
    models.some(
      model => model.providerKey === ProviderName.DeepSeek && model.id === 'deepseek-chat',
    ),
  ).toBe(false);
  expect(models.some(model => model.providerKey === ProviderName.LlamaCpp)).toBe(true);
});

test('hides stale connection metadata', async () => {
  const config = createConfig();
  const deepSeekConfig = config.providers![ProviderName.DeepSeek];
  const staleSignature = await createProviderConnectionTestSignature({
    providerId: ProviderName.DeepSeek,
    baseUrl: deepSeekConfig.baseUrl,
    apiFormat: 'anthropic',
    provider: { ...deepSeekConfig, apiKey: 'old-key' },
  });
  deepSeekConfig.models![0].connectionTest = {
    status: ProviderModelConnectionTestStatus.Success,
    signature: staleSignature,
    testedAt: 1,
  };

  vi.stubGlobal('window', {
    electron: {
      llamacpp: { listRunningModels: vi.fn(async () => []) },
    },
  });

  const models = await collectAvailableModels(config);
  expect(
    models.some(
      model => model.providerKey === ProviderName.DeepSeek && model.id === 'deepseek-chat',
    ),
  ).toBe(false);
});

test('hides provider-level failures', async () => {
  const config = createConfig();
  const deepSeekConfig = config.providers![ProviderName.DeepSeek];
  const signature = await createProviderConnectionTestSignature({
    providerId: ProviderName.DeepSeek,
    baseUrl: deepSeekConfig.baseUrl,
    apiFormat: 'anthropic',
    provider: deepSeekConfig,
  });
  deepSeekConfig.models![0].connectionTest = {
    status: ProviderModelConnectionTestStatus.Failure,
    failureKind: ProviderModelConnectionFailureKind.Server,
    signature,
    testedAt: 1,
  };

  vi.stubGlobal('window', {
    electron: {
      llamacpp: { listRunningModels: vi.fn(async () => []) },
    },
  });

  const models = await collectAvailableModels(config);
  expect(
    models.some(
      model => model.providerKey === ProviderName.DeepSeek && model.id === 'deepseek-chat',
    ),
  ).toBe(false);
});