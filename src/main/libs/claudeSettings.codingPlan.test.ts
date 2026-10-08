import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  ApiFormat,
  ModelCapabilityStatus,
  ProviderModelOrigin,
  ProviderModelPiApi,
  ProviderName,
  type ProviderConfig,
} from '../../shared/providers';
import {
  resolveAllEnabledProviderConfigs,
  resolveRawApiConfig,
  resolveRawApiConfigForModelRef,
  setStoreGetter,
} from './claudeSettings';

vi.mock('./coworkOpenAICompatProxy', () => ({
  configureCoworkOpenAICompatProxy: vi.fn(),
  getCoworkOpenAICompatProxyBaseURL: () => 'http://127.0.0.1:3456/v1',
  getCoworkOpenAICompatProxyStatus: vi.fn(() => ({ running: true })),
  getCoworkOpenAICompatProxyToken: () => 'proxy-auth-token',
}));

const CodingModelId = {
  Default: 'kimi-for-coding',
  HighSpeed: 'kimi-for-coding-highspeed',
  K3: 'k3',
  K3Small: 'k3-256k',
  User: 'my-coding-model',
  StaleGeneral: 'kimi-k2.6',
} as const;
const CODING_BASE_URL = 'https://api.kimi.com/coding';
const TEST_API_KEY = 'test-coding-plan-key';
type SavedModel = NonNullable<ProviderConfig['models']>[number];

function useCodingPlanConfig(models: SavedModel[], defaultModel: string = CodingModelId.Default) {
  const provider: ProviderConfig = {
    enabled: true,
    apiKey: TEST_API_KEY,
    baseUrl: 'https://api.moonshot.cn/v1',
    apiFormat: ApiFormat.OpenAI,
    codingPlanEnabled: true,
    models,
  };
  const appConfig = {
    model: { defaultModel, defaultModelProvider: ProviderName.Moonshot },
    providers: { [ProviderName.Moonshot]: provider },
  };
  setStoreGetter(
    () =>
      ({
        get: (key: string) => (key === 'app_config' ? appConfig : undefined),
      }) as never,
  );
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  setStoreGetter(() => null);
  vi.restoreAllMocks();
});

test('resolves all five saved coding models through the coding-plan endpoint', () => {
  const models: SavedModel[] = [
    CodingModelId.Default,
    CodingModelId.HighSpeed,
    CodingModelId.K3,
    CodingModelId.K3Small,
    CodingModelId.User,
  ].map((id, index) => ({
    id,
    name: `Saved model ${index + 1}`,
    origin: id === CodingModelId.User ? ProviderModelOrigin.User : ProviderModelOrigin.Discovered,
    contextWindow: 131_072 + index * 16_384,
    maxTokens: 4_096 + index * 1_024,
    capabilities: {
      toolCalling: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    piRuntime: {
      api: ProviderModelPiApi.AnthropicMessages,
      reasoning: true,
      compaction: { reserveTokens: 8_192 + index * 1_024 },
    },
  }));
  useCodingPlanConfig(models);

  const enabledProviders = resolveAllEnabledProviderConfigs();
  expect(enabledProviders).toHaveLength(1);
  expect(enabledProviders[0]).toMatchObject({
    providerName: ProviderName.Moonshot,
    baseURL: CODING_BASE_URL,
    apiType: ApiFormat.Anthropic,
    codingPlanEnabled: true,
  });
  expect(enabledProviders[0].models.map(model => model.id)).toEqual(models.map(model => model.id));

  for (const model of models) {
    const resolution = resolveRawApiConfigForModelRef(`${ProviderName.Moonshot}/${model.id}`);
    expect(resolution.error).toBeUndefined();
    expect(resolution.config).toEqual({
      apiKey: TEST_API_KEY,
      baseURL: CODING_BASE_URL,
      model: model.id,
      apiType: ApiFormat.Anthropic,
    });
    expect(resolution.providerMetadata).toMatchObject({
      providerName: ProviderName.Moonshot,
      codingPlanEnabled: true,
      modelName: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      piRuntime: model.piRuntime,
    });
    expect(resolution.endpoint).toMatchObject({
      providerId: ProviderName.Moonshot,
      modelId: model.id,
      protocol: ApiFormat.Anthropic,
      baseUrl: CODING_BASE_URL,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      capabilities: model.capabilities,
    });
  }
});

test('keeps saved coding-plan capacity and runtime settings with the canonical catalog name', () => {
  const model: SavedModel = {
    id: CodingModelId.Default,
    name: 'Stale catalog label',
    contextWindow: 196_608,
    maxTokens: 12_288,
    piRuntime: {
      api: ProviderModelPiApi.AnthropicMessages,
      reasoning: true,
      compaction: { reserveTokens: 16_384, keepRecentTokens: 8_192 },
    },
  };
  useCodingPlanConfig([model]);

  expect(resolveRawApiConfig().providerMetadata).toMatchObject({
    providerName: ProviderName.Moonshot,
    modelName: 'Kimi for Coding',
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    piRuntime: model.piRuntime,
  });
});

test('ignores stale general defaults for coding-plan explicit and fallback selection', () => {
  useCodingPlanConfig(
    [
      { id: CodingModelId.StaleGeneral, name: 'Kimi K2.6', supportsImage: true },
      { id: CodingModelId.Default, name: 'Kimi K2.5', supportsImage: true },
    ],
    CodingModelId.StaleGeneral,
  );

  expect(resolveAllEnabledProviderConfigs()[0].models.map(model => model.id)).toEqual([
    CodingModelId.Default,
  ]);
  expect(resolveRawApiConfig().config).toMatchObject({
    model: CodingModelId.Default,
    baseURL: CODING_BASE_URL,
    apiType: ApiFormat.Anthropic,
  });
  const staleSelection = resolveRawApiConfigForModelRef(
    `${ProviderName.Moonshot}/${CodingModelId.StaleGeneral}`,
  );
  expect(staleSelection.config).toBeNull();
  expect(staleSelection.error).toContain(CodingModelId.StaleGeneral);
});
