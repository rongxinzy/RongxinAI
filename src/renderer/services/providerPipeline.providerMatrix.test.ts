import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ApiRequestPurpose } from '@shared/ipc/apiRequest';
import {
  ApiFormat,
  applyProviderModelConnectionTestResults,
  createProviderConnectionTestSignature,
  ModelCapabilityStatus,
  ProviderModelConnectionFailureKind,
  ProviderModelOrigin,
  ProviderName,
  ProviderRegistry,
  type ProviderConfig,
} from '@shared/providers';

import { CONFIG_KEYS, defaultConfig, type AppConfig } from '../config';
import { resolveAgentModelRef, toAgentModelRef } from '../utils/agentModelRef';
import { collectAvailableModels } from './availableModels';
import { ConfigService } from './config';
import {
  testProviderModelsConcurrently,
  type ProviderModelConnectionTestResponse,
} from './providerModelConnection';
import { applyProviderModelDiscoveryResult } from './providerModelDiscovery';
import { localStore } from './store';

vi.mock('./store', () => ({
  localStore: { getItem: vi.fn(), setItem: vi.fn() },
}));

interface ProviderCase {
  providerId: string;
  apiFormat: ApiFormat;
  codingPlanEnabled: boolean;
}

interface MockConnectionRequest {
  url: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  purpose?: string;
}

// Managed access and local runtimes use separate availability paths. Every other
// registered preset uses a stored API credential, including Copilot, whose device
// authorization stores the exchanged token in apiKey without an apiKeyUrl entry.
const separatelyManagedProviders: ReadonlySet<string> = new Set([
  ProviderName.Zhiyuan,
  ProviderName.Ollama,
  ProviderName.LlamaCpp,
]);
const cloudProviders = ProviderRegistry.providerIds.filter(
  providerId => !separatelyManagedProviders.has(providerId),
);
const providerCases: ProviderCase[] = cloudProviders.flatMap(providerId => {
  const definition = ProviderRegistry.get(providerId)!;
  const formats = definition.switchableBaseUrls
    ? [ApiFormat.Anthropic, ApiFormat.OpenAI]
    : [definition.defaultApiFormat];
  return formats.flatMap(apiFormat => [
    { providerId, apiFormat, codingPlanEnabled: false },
    ...(definition.codingPlanSupported ? [{ providerId, apiFormat, codingPlanEnabled: true }] : []),
  ]);
});

const TEST_CREDENTIAL = 'mock-provider-key';
const TESTED_AT = 1_700_000_000_000;
let storedConfig: AppConfig;
const fetchMock =
  vi.fn<(request: MockConnectionRequest) => Promise<ProviderModelConnectionTestResponse>>();

beforeEach(() => {
  storedConfig = structuredClone(defaultConfig);
  vi.mocked(localStore.getItem).mockImplementation(async () => structuredClone(storedConfig));
  vi.mocked(localStore.setItem).mockImplementation(async (key, value) => {
    expect(key).toBe(CONFIG_KEYS.APP_CONFIG);
    storedConfig = structuredClone(value as AppConfig);
  });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    electron: {
      api: { fetch: fetchMock },
      llamacpp: { listRunningModels: vi.fn(async () => []) },
    },
  });
  // Any accidental direct network access fails the test instead of contacting a provider.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('Unexpected real request'))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createDiscoveredProvider(input: ProviderCase): ProviderConfig {
  const definition = ProviderRegistry.get(input.providerId)!;
  const firstModel =
    (input.codingPlanEnabled ? definition.codingPlanModels?.[0] : undefined) ??
    definition.defaultModels[0];
  const discovered = applyProviderModelDiscoveryResult([], {
    success: true,
    models: Array.from({ length: 5 }, (_, index) => ({
      id: index === 0 ? firstModel.id : `endpoint-model-${index}`,
      displayName: `Endpoint Model ${index}`,
      contextWindow: 128_000 + index,
      maxTokens: 16_000 + index,
      capabilities: {
        toolCalling: ModelCapabilityStatus.Supported,
        imageInput: ModelCapabilityStatus.Unsupported,
      },
    })),
  });
  return {
    enabled: true,
    apiKey: TEST_CREDENTIAL,
    apiFormat: input.apiFormat,
    codingPlanEnabled: input.codingPlanEnabled,
    baseUrl:
      input.apiFormat === ApiFormat.Gemini
        ? definition.defaultBaseUrl
        : (definition.switchableBaseUrls?.[input.apiFormat] ?? definition.defaultBaseUrl),
    models: discovered.models,
  };
}

async function probeProvider(input: ProviderCase, provider: ProviderConfig) {
  const signature = await createProviderConnectionTestSignature({
    providerId: input.providerId,
    provider,
    baseUrl: provider.baseUrl,
    apiFormat: input.apiFormat,
  });
  const results = await testProviderModelsConcurrently({
    providerId: input.providerId,
    provider,
    baseUrl: provider.baseUrl,
    apiFormat: input.apiFormat,
    models: provider.models!,
  });
  return applyProviderModelConnectionTestResults(
    provider,
    results.map(({ model, result }) => ({
      modelId: model.id,
      success: result.success,
      ...(!result.success ? { failureKind: result.failureKind } : {}),
    })),
    signature,
    TESTED_AT,
  );
}

async function saveAndReload(providerId: string, provider: ProviderConfig) {
  const service = new ConfigService();
  await service.updateConfig({
    providers: { ...storedConfig.providers, [providerId]: provider },
  });
  await service.reload();
  const config = await service.reload();
  return {
    config,
    provider: config.providers![providerId],
    models: (await collectAvailableModels(config)).filter(
      model => model.providerKey === providerId,
    ),
  };
}

test('matrix includes every API-key cloud preset and all six coding-plan presets', () => {
  expect([...cloudProviders].sort()).toEqual(
    [
      ProviderName.DeepSeek,
      ProviderName.Moonshot,
      ProviderName.Qwen,
      ProviderName.Zhipu,
      ProviderName.Minimax,
      ProviderName.Volcengine,
      ProviderName.Qianfan,
      ProviderName.StepFun,
      ProviderName.Xiaomi,
      ProviderName.Copilot,
      ProviderName.Grok,
      ProviderName.OpenAI,
      ProviderName.Gemini,
      ProviderName.Anthropic,
      ProviderName.OpenRouter,
    ].sort(),
  );
  expect(
    [
      ...new Set(
        providerCases.filter(input => input.codingPlanEnabled).map(input => input.providerId),
      ),
    ].sort(),
  ).toEqual(
    [
      ProviderName.Moonshot,
      ProviderName.Qwen,
      ProviderName.Zhipu,
      ProviderName.Volcengine,
      ProviderName.Qianfan,
      ProviderName.Xiaomi,
    ].sort(),
  );
});

test.each(providerCases)(
  '$providerId / $apiFormat / coding=$codingPlanEnabled: five discovered models remain selectable after two reloads',
  async input => {
    const discovered = createDiscoveredProvider(input);
    const tested = await probeProvider(input, discovered);
    const { provider, models } = await saveAndReload(input.providerId, tested);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(models).toHaveLength(5);
    expect(models.map(model => model.id).sort()).toEqual(
      discovered.models!.map(model => model.id).sort(),
    );
    for (const expected of tested.models!) {
      expect(provider.models?.find(model => model.id === expected.id)).toMatchObject({
        id: expected.id,
        name: expected.name,
        origin: expected.origin,
        contextWindow: expected.contextWindow,
        maxTokens: expected.maxTokens,
        connectionTest: expected.connectionTest,
      });
      if (expected.id.startsWith('endpoint-model-')) {
        expect(
          provider.models?.find(model => model.id === expected.id)?.capabilities,
        ).toMatchObject({ imageInput: ModelCapabilityStatus.Unsupported });
      }
      const selected = models.find(model => model.id === expected.id)!;
      expect(selected).toMatchObject({
        name: expected.name,
        providerKey: input.providerId,
        agentProviderId: ProviderRegistry.getAgentProviderId(input.providerId),
        contextWindow: expected.contextWindow,
      });
      expect(resolveAgentModelRef(toAgentModelRef(selected), models)).toBe(selected);
      if (
        input.providerId !== ProviderName.Moonshot ||
        input.codingPlanEnabled ||
        input.apiFormat !== ApiFormat.Anthropic
      ) {
        expect(selected.capabilities?.toolCalling).toBe(ModelCapabilityStatus.Supported);
      }
    }
    for (const [request] of fetchMock.mock.calls) {
      expect(request.purpose).toBe(ApiRequestPurpose.ConnectivityTest);
      expect(request.method).toBe('POST');
      expect(request.url).not.toContain('undefined');
      const effectiveFormat = input.codingPlanEnabled
        ? (ProviderRegistry.get(input.providerId)?.preferredCodingPlanFormat ?? input.apiFormat)
        : input.apiFormat;
      if (effectiveFormat === ApiFormat.Gemini) {
        expect(request.url).toMatch(/\/models\/.+:generateContent$/);
        expect(request.headers?.['x-goog-api-key']).toBe(TEST_CREDENTIAL);
      } else if (effectiveFormat === ApiFormat.Anthropic) {
        expect(request.url).toMatch(/\/v1\/messages$/);
        expect(request.headers?.['x-api-key']).toBe(TEST_CREDENTIAL);
      } else {
        expect(request.url).toMatch(
          input.providerId === ProviderName.OpenAI ? /\/responses$/ : /\/chat\/completions$/,
        );
        expect(request.headers?.Authorization).toBe(`Bearer ${TEST_CREDENTIAL}`);
      }
      if (input.codingPlanEnabled && effectiveFormat !== ApiFormat.Gemini) {
        expect(request.url).toContain(
          ProviderRegistry.get(input.providerId)?.codingPlanUrls?.[effectiveFormat],
        );
      }
    }
  },
);

test('Copilot API-key requests use the root chat route and integration headers for all five models', async () => {
  const input: ProviderCase = {
    providerId: ProviderName.Copilot,
    apiFormat: ApiFormat.OpenAI,
    codingPlanEnabled: false,
  };
  const provider = createDiscoveredProvider(input);
  provider.authType = 'apikey';
  // This boundary starts after a credential exists. Device-code authorization,
  // token exchange, automatic token refresh, and OAuth UI are not exercised here.
  const tested = await probeProvider(input, provider);
  const { models } = await saveAndReload(input.providerId, tested);

  expect(models).toHaveLength(5);
  expect(fetchMock).toHaveBeenCalledTimes(5);
  for (const [index, [request]] of fetchMock.mock.calls.entries()) {
    expect(request.url).toBe('https://api.individual.githubcopilot.com/chat/completions');
    expect(request.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TEST_CREDENTIAL}`,
      'Copilot-Integration-Id': 'vscode-chat',
      'Editor-Version': 'vscode/1.96.2',
      'Editor-Plugin-Version': 'copilot-chat/0.26.7',
      'User-Agent': 'GitHubCopilotChat/0.26.7',
      'Openai-Intent': 'conversation-panel',
    });
    expect(JSON.parse(request.body!)).toEqual({
      model: provider.models![index].id,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 64,
    });
  }
});

test.each(providerCases)(
  '$providerId / $apiFormat / coding=$codingPlanEnabled: one success cannot expose failed or untested models',
  async input => {
    const discovered = createDiscoveredProvider(input);
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        data: { error: { message: 'model_not_found' } },
      })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockRejectedValueOnce(new Error('Mock transport failure'));
    const tested = await probeProvider(input, discovered);
    tested.models!.push({ id: 'untested-model', name: 'Untested Model' });
    const { models } = await saveAndReload(input.providerId, tested);

    expect(models.map(model => model.id)).toEqual([discovered.models![0].id]);
    expect(tested.models!.slice(1, 5).map(model => model.connectionTest?.failureKind)).toEqual([
      ProviderModelConnectionFailureKind.Auth,
      ProviderModelConnectionFailureKind.Model,
      ProviderModelConnectionFailureKind.Server,
      ProviderModelConnectionFailureKind.Network,
    ]);
  },
);

test.each(providerCases)(
  '$providerId / $apiFormat / coding=$codingPlanEnabled: changed credentials invalidate all five successes',
  async input => {
    const tested = await probeProvider(input, createDiscoveredProvider(input));
    const { models } = await saveAndReload(input.providerId, {
      ...tested,
      apiKey: 'changed-mock-key',
    });
    expect(models).toEqual([]);
  },
);

test.each(providerCases)(
  '$providerId / $apiFormat / coding=$codingPlanEnabled: disabling a provider hides all five successes',
  async input => {
    const tested = await probeProvider(input, createDiscoveredProvider(input));
    const { models } = await saveAndReload(input.providerId, { ...tested, enabled: false });
    expect(models).toEqual([]);
  },
);

test.each(providerCases)(
  '$providerId / $apiFormat / coding=$codingPlanEnabled: equivalent endpoint formatting survives persistence',
  async input => {
    const provider = createDiscoveredProvider(input);
    provider.baseUrl = `  ${provider.baseUrl}///  `;
    const tested = await probeProvider(input, provider);
    const { models } = await saveAndReload(input.providerId, tested);
    expect(models).toHaveLength(5);
  },
);

test.each(providerCases.filter(input => !input.codingPlanEnabled))(
  '$providerId / $apiFormat: an actual endpoint change invalidates successful tests',
  async input => {
    const tested = await probeProvider(input, createDiscoveredProvider(input));
    const { models } = await saveAndReload(input.providerId, {
      ...tested,
      baseUrl: 'https://changed-endpoint.invalid/v1',
    });
    expect(models).toEqual([]);
  },
);

test.each([
  'https://generativelanguage.googleapis.com/v1beta/openai',
  'https://generativelanguage.googleapis.com/v1/openai',
  'https://generativelanguage.googleapis.com/v1',
])(
  'native Gemini normalization is idempotent across save and repeated reload: %s',
  async baseUrl => {
    const input: ProviderCase = {
      providerId: ProviderName.Gemini,
      apiFormat: ApiFormat.Gemini,
      codingPlanEnabled: false,
    };
    const provider = createDiscoveredProvider(input);
    provider.baseUrl = baseUrl;
    const tested = await probeProvider(input, provider);
    const service = new ConfigService();
    await service.updateConfig({
      providers: { ...storedConfig.providers, [input.providerId]: tested },
    });
    for (let reload = 0; reload < 3; reload += 1) {
      const config = reload === 0 ? service.getConfig() : await service.reload();
      expect(config.providers![input.providerId].baseUrl).toBe(
        'https://generativelanguage.googleapis.com/v1beta',
      );
      expect(await collectAvailableModels(config)).toHaveLength(5);
      expect(config.providers![input.providerId].models?.[0].connectionTest).toEqual(
        tested.models![0].connectionTest,
      );
    }
    for (const [request] of fetchMock.mock.calls) {
      expect(request.url).toMatch(
        /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/,
      );
    }
  },
);

test.each(providerCases.filter(input => input.codingPlanEnabled))(
  '$providerId / $apiFormat: a renamed coding-plan model retains its tested metadata',
  async input => {
    const discovered = createDiscoveredProvider(input);
    const editedModel = discovered.models![0];
    editedModel.name = 'My renamed model';
    editedModel.origin = ProviderModelOrigin.User;
    editedModel.piRuntime = { reasoning: true };
    const tested = await probeProvider(input, discovered);
    const { provider, models } = await saveAndReload(input.providerId, tested);
    expect(provider.models?.find(model => model.id === editedModel.id)).toMatchObject({
      id: editedModel.id,
      name: editedModel.name,
      origin: editedModel.origin,
      contextWindow: editedModel.contextWindow,
      maxTokens: editedModel.maxTokens,
      piRuntime: editedModel.piRuntime,
      capabilities: editedModel.capabilities,
      supportsImage: editedModel.supportsImage,
      connectionTest: tested.models![0].connectionTest,
    });
    expect(models.find(model => model.id === editedModel.id)).toMatchObject({
      name: 'My renamed model',
      supportsImage: false,
      capabilities: editedModel.capabilities,
    });
  },
);

test('the same model ID across every provider retains independent selectable identities', async () => {
  const service = new ConfigService();
  const providers = { ...storedConfig.providers };
  for (const providerId of cloudProviders) {
    const input: ProviderCase = {
      providerId,
      apiFormat: ProviderRegistry.get(providerId)!.defaultApiFormat,
      codingPlanEnabled: false,
    };
    const provider = createDiscoveredProvider(input);
    provider.models = [{ id: 'shared-model-id', name: `${providerId} model` }];
    providers[providerId] = await probeProvider(input, provider);
  }
  await service.updateConfig({ providers });
  const models = await collectAvailableModels(await service.reload());

  expect(models).toHaveLength(cloudProviders.length);
  expect(new Set(models.map(toAgentModelRef)).size).toBe(cloudProviders.length);
  expect(resolveAgentModelRef('shared-model-id', models)).toBeNull();
  for (const model of models) {
    expect(resolveAgentModelRef(toAgentModelRef(model), models)).toBe(model);
  }
});
