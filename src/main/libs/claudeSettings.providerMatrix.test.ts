import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  ApiFormat,
  applyProviderModelConnectionTestResults,
  createProviderConnectionTestSignature,
  isLocalProviderName,
  ProviderModelOrigin,
  ProviderName,
  ProviderRegistry,
  resolveConfiguredProviderModels,
  type ProviderConfig,
} from '../../shared/providers';
import {
  resolveAllEnabledProviderConfigs,
  resolveRawApiConfigForModelRef,
  setStoreGetter,
} from './claudeSettings';
import { readOpenAICodexAuthFile } from './openaiCodexAuth';

vi.mock('./coworkOpenAICompatProxy', () => ({
  configureCoworkOpenAICompatProxy: vi.fn(),
  getCoworkOpenAICompatProxyBaseURL: () => 'http://127.0.0.1:3456/v1',
  getCoworkOpenAICompatProxyStatus: vi.fn(() => ({ running: true })),
  getCoworkOpenAICompatProxyToken: () => 'mock-proxy-token',
}));
vi.mock('./openaiCodexAuth', () => ({ readOpenAICodexAuthFile: vi.fn(() => null) }));

const AuthType = { ApiKey: 'apikey', OAuth: 'oauth' } as const;
const MOCK_OAUTH_TOKEN = 'mock-oauth-access-token';
const MOCK_OAUTH_BASE_URL = 'https://oauth-endpoint.example/anthropic';
const MISSING_MODEL_ID = 'not-in-the-saved-catalog';
const MODEL_COUNT = 5;

const cloudProviderIds = ProviderRegistry.providerIds.filter(
  id => !isLocalProviderName(id) && id !== ProviderName.Zhiyuan,
);
const providerCases = cloudProviderIds.flatMap(providerName => [
  { providerName, codingPlanEnabled: false },
  ...(ProviderRegistry.supportsCodingPlan(providerName)
    ? [{ providerName, codingPlanEnabled: true }]
    : []),
]);

interface ProviderCase {
  providerName: string;
  codingPlanEnabled: boolean;
}

async function makeProvider({
  providerName,
  codingPlanEnabled,
}: ProviderCase): Promise<ProviderConfig> {
  const definition = ProviderRegistry.get(providerName)!;
  const presets = codingPlanEnabled ? definition.codingPlanModels! : definition.defaultModels;
  const models: NonNullable<ProviderConfig['models']> = presets
    .slice(0, codingPlanEnabled ? MODEL_COUNT : 2)
    .map(model => ({ ...model, origin: ProviderModelOrigin.Discovered }));
  while (models.length < MODEL_COUNT) {
    models.push({
      id: `mock/extra-model-${models.length + 1}`,
      name: `Discovered model ${models.length + 1}`,
      origin: ProviderModelOrigin.Discovered,
      contextWindow: 65_536,
      maxTokens: 4_096,
    });
  }
  const provider: ProviderConfig = {
    enabled: true,
    authType: AuthType.ApiKey,
    apiKey: `mock-api-key-${providerName}`,
    baseUrl: definition.defaultBaseUrl,
    apiFormat: definition.defaultApiFormat,
    codingPlanEnabled,
    models,
  };
  const signature = await createProviderConnectionTestSignature({
    providerId: providerName,
    baseUrl: provider.baseUrl,
    apiFormat: provider.apiFormat!,
    provider,
  });
  const tested = applyProviderModelConnectionTestResults(
    provider,
    models.map(model => ({ modelId: model.id, success: true })),
    signature,
    1_800_000_000_000,
  );
  return {
    ...tested,
    models: resolveConfiguredProviderModels(providerName, tested),
  };
}

function useProvider(providerName: string, provider: ProviderConfig): void {
  // Model data crosses the saved JSON boundary before main-process resolution.
  const saved = JSON.stringify({ providers: { [providerName]: provider } });
  setStoreGetter(
    () =>
      ({ get: (key: string) => (key === 'app_config' ? JSON.parse(saved) : undefined) }) as never,
  );
}

function expectedConnection({ providerName, codingPlanEnabled }: ProviderCase) {
  const definition = ProviderRegistry.get(providerName)!;
  const apiType = codingPlanEnabled
    ? (definition.preferredCodingPlanFormat ?? definition.defaultApiFormat)
    : definition.defaultApiFormat === ApiFormat.Gemini
      ? ApiFormat.OpenAI
      : definition.defaultApiFormat;
  const baseURL = codingPlanEnabled
    ? definition.codingPlanUrls![apiType as 'anthropic' | 'openai']!
    : definition.defaultBaseUrl;
  return { apiType, baseURL };
}

beforeEach(() => {
  vi.mocked(readOpenAICodexAuthFile).mockReturnValue(null);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('Network is forbidden in this test'))),
  );
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  setStoreGetter(() => null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test.each(providerCases)(
  '$providerName codingPlan=$codingPlanEnabled resolves every saved model consistently',
  async providerCase => {
    const { providerName, codingPlanEnabled } = providerCase;
    const provider = await makeProvider(providerCase);
    useProvider(providerName, provider);
    const expected = expectedConnection(providerCase);
    const enabled = resolveAllEnabledProviderConfigs();
    expect(enabled).toHaveLength(1);
    expect(enabled[0]).toMatchObject({
      ...expected,
      providerName,
      apiKey: provider.apiKey,
      codingPlanEnabled,
      authType: AuthType.ApiKey,
    });
    expect(enabled[0].models.map(model => model.id)).toEqual(
      provider.models!.map(model => model.id),
    );
    expect(enabled[0].models).toHaveLength(MODEL_COUNT);

    for (const model of provider.models!) {
      const resolution = resolveRawApiConfigForModelRef(`${providerName}/${model.id}`);
      expect(resolution.error).toBeUndefined();
      expect(resolution.config).toEqual({ ...expected, apiKey: provider.apiKey, model: model.id });
      expect(resolution.providerMetadata).toMatchObject({
        providerName,
        codingPlanEnabled,
        authType: AuthType.ApiKey,
        modelName: model.name,
      });
      expect(resolution.endpoint).toMatchObject({
        providerId: providerName,
        modelId: model.id,
        baseUrl: expected.baseURL,
        apiKey: provider.apiKey,
        // The compatibility config remains OpenAI-shaped for Gemini, while
        // the endpoint describes its native protocol for runtime consumers.
        protocol: providerName === ProviderName.Gemini ? ApiFormat.Gemini : expected.apiType,
      });
    }
  },
);

test.each(providerCases)(
  '$providerName codingPlan=$codingPlanEnabled rejects disabled and missing model selections',
  async providerCase => {
    const { providerName } = providerCase;
    const provider = await makeProvider(providerCase);
    useProvider(providerName, { ...provider, enabled: false });
    expect(resolveAllEnabledProviderConfigs()).toEqual([]);
    expect(
      resolveRawApiConfigForModelRef(`${providerName}/${provider.models![0].id}`),
    ).toMatchObject({
      config: null,
      error: expect.stringContaining('not enabled'),
    });

    useProvider(providerName, provider);
    expect(resolveRawApiConfigForModelRef(`${providerName}/${MISSING_MODEL_ID}`)).toMatchObject({
      config: null,
      error: expect.stringContaining(MISSING_MODEL_ID),
    });
  },
);

test.each(providerCases)(
  '$providerName codingPlan=$codingPlanEnabled rejects missing API credentials consistently',
  async providerCase => {
    const { providerName } = providerCase;
    const provider = await makeProvider(providerCase);
    useProvider(providerName, { ...provider, apiKey: '   ' });
    expect(resolveAllEnabledProviderConfigs()).toEqual([]);
    const resolution = resolveRawApiConfigForModelRef(`${providerName}/${provider.models![0].id}`);
    expect(resolution.config).toBeNull();
    expect(resolution.error).toBeTruthy();
  },
);

test('MiniMax OAuth selects its token and resource endpoint, and rejects incomplete login', async () => {
  const provider = await makeProvider({
    providerName: ProviderName.Minimax,
    codingPlanEnabled: false,
  });
  const oauthProvider: ProviderConfig = {
    ...provider,
    authType: AuthType.OAuth,
    oauthAccessToken: MOCK_OAUTH_TOKEN,
    oauthBaseUrl: MOCK_OAUTH_BASE_URL,
  };
  useProvider(ProviderName.Minimax, oauthProvider);
  expect(resolveAllEnabledProviderConfigs()[0]).toMatchObject({
    apiKey: MOCK_OAUTH_TOKEN,
    baseURL: MOCK_OAUTH_BASE_URL,
    authType: AuthType.OAuth,
    apiType: ApiFormat.Anthropic,
  });
  for (const model of provider.models!) {
    const resolution = resolveRawApiConfigForModelRef(`${ProviderName.Minimax}/${model.id}`);
    expect(resolution.config).toMatchObject({
      apiKey: MOCK_OAUTH_TOKEN,
      baseURL: MOCK_OAUTH_BASE_URL,
      apiType: ApiFormat.Anthropic,
    });
    expect(resolution.endpoint).toMatchObject({
      apiKey: MOCK_OAUTH_TOKEN,
      baseUrl: MOCK_OAUTH_BASE_URL,
    });
  }

  useProvider(ProviderName.Minimax, { ...oauthProvider, oauthAccessToken: '' });
  expect(resolveAllEnabledProviderConfigs()).toEqual([]);
  expect(
    resolveRawApiConfigForModelRef(`${ProviderName.Minimax}/${provider.models![0].id}`),
  ).toMatchObject({
    config: null,
    error: expect.stringContaining('login not completed'),
  });
});

test('OpenAI OAuth records explicit and stored-login selection without reading real auth files', async () => {
  const provider = await makeProvider({
    providerName: ProviderName.OpenAI,
    codingPlanEnabled: false,
  });
  const noKey = { ...provider, apiKey: '' };
  const modelRef = `${ProviderName.OpenAI}/${provider.models![0].id}`;
  useProvider(ProviderName.OpenAI, { ...noKey, authType: AuthType.OAuth });
  expect(resolveAllEnabledProviderConfigs()[0]).toMatchObject({
    apiKey: '',
    authType: AuthType.OAuth,
  });
  expect(resolveRawApiConfigForModelRef(modelRef).providerMetadata?.authType).toBe(AuthType.OAuth);

  vi.mocked(readOpenAICodexAuthFile).mockReturnValue({
    accessToken: MOCK_OAUTH_TOKEN,
    refreshToken: 'mock-oauth-refresh-token',
    expiresAt: 1_900_000_000_000,
  });
  useProvider(ProviderName.OpenAI, noKey);
  expect(resolveAllEnabledProviderConfigs()[0]).toMatchObject({
    apiKey: '',
    authType: AuthType.OAuth,
  });
  expect(resolveRawApiConfigForModelRef(modelRef).providerMetadata?.authType).toBe(AuthType.OAuth);
});

test('managed ZhiYuan configuration does not require a user API key', async () => {
  const provider = await makeProvider({
    providerName: ProviderName.Zhiyuan,
    codingPlanEnabled: false,
  });
  useProvider(ProviderName.Zhiyuan, { ...provider, apiKey: '' });
  expect(resolveAllEnabledProviderConfigs()).toHaveLength(1);
  expect(
    resolveRawApiConfigForModelRef(`${ProviderName.Zhiyuan}/${provider.models![0].id}`).config,
  ).toMatchObject({
    apiKey: 'sk-zhiyuan-managed',
    baseURL: provider.baseUrl,
  });
});
