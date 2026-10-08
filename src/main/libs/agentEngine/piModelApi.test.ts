import type { Model } from '@earendil-works/pi-ai';
import { completeSimple } from '@earendil-works/pi-ai/compat';
import { afterEach, expect, test, vi } from 'vitest';

import {
  ApiFormat,
  isLocalProviderName,
  ProviderModelPiApi,
  ProviderName,
  ProviderRegistry,
  resolveModelEndpoint,
} from '../../../shared/providers';
import type { ApiConfigResolution } from '../claudeSettings';
import { PiModelApi, resolvePiCustomModelApi } from './piModelApi';

const MOCK_API_KEY = 'mock-pi-api-key';
const EXTRA_MODEL_ID = 'new-endpoint-model';
const MOCK_BASE_URL = 'https://model-endpoint.example/v1';
const CUSTOM_PROVIDER = 'custom_test';

function resolutionFor(
  providerName: string,
  apiFormat: ApiFormat,
  codingPlanEnabled = false,
): ApiConfigResolution {
  const endpoint = resolveModelEndpoint(providerName, EXTRA_MODEL_ID, {
    providerConfig: {
      apiKey: MOCK_API_KEY,
      baseUrl: ProviderRegistry.get(providerName)?.defaultBaseUrl ?? MOCK_BASE_URL,
      apiFormat,
      codingPlanEnabled,
    },
  });
  return {
    endpoint,
    config: {
      apiKey: MOCK_API_KEY,
      model: EXTRA_MODEL_ID,
      baseURL: endpoint.baseUrl,
      apiType: endpoint.protocol === ApiFormat.Anthropic ? ApiFormat.Anthropic : ApiFormat.OpenAI,
    },
    providerMetadata: { providerName, codingPlanEnabled },
  };
}

const providerCases = ProviderRegistry.providerIds
  .filter(providerName => !isLocalProviderName(providerName))
  .flatMap(providerName => {
    const definition = ProviderRegistry.get(providerName)!;
    const normalExpected =
      definition.defaultApiFormat === ApiFormat.Gemini
        ? PiModelApi.GoogleGenerativeAI
        : definition.defaultApiFormat === ApiFormat.Anthropic
          ? PiModelApi.AnthropicMessages
          : providerName === ProviderName.OpenAI
            ? PiModelApi.OpenAIResponses
            : PiModelApi.OpenAICompletions;
    return [
      { providerName, codingPlanEnabled: false, expected: normalExpected },
      ...(definition.codingPlanSupported
        ? [
            {
              providerName,
              codingPlanEnabled: true,
              expected:
                (definition.preferredCodingPlanFormat ?? definition.defaultApiFormat) ===
                ApiFormat.Anthropic
                  ? PiModelApi.AnthropicMessages
                  : PiModelApi.OpenAICompletions,
            },
          ]
        : []),
    ];
  });

afterEach(() => vi.unstubAllGlobals());

test.each(providerCases)(
  '$providerName codingPlan=$codingPlanEnabled uses the configured protocol for a non-catalog model',
  ({ providerName, codingPlanEnabled, expected }) => {
    const resolution = resolutionFor(
      providerName,
      ProviderRegistry.get(providerName)!.defaultApiFormat,
      codingPlanEnabled,
    );
    expect(resolvePiCustomModelApi(resolution)).toBe(expected);
  },
);

test.each(Object.values(ProviderModelPiApi))(
  'explicit per-model API %s wins over endpoint defaults',
  api => {
    const resolution = resolutionFor(ProviderName.Gemini, ApiFormat.Gemini);
    resolution.providerMetadata!.piRuntime = { api };
    expect(resolvePiCustomModelApi(resolution)).toBe(api);
  },
);

test('uses endpoint protocol before the compatibility config, with unchanged legacy fallbacks', () => {
  const resolution = resolutionFor(CUSTOM_PROVIDER, ApiFormat.Anthropic);
  resolution.config!.apiType = ApiFormat.OpenAI;
  expect(resolvePiCustomModelApi(resolution)).toBe(PiModelApi.AnthropicMessages);
  delete resolution.endpoint;
  expect(resolvePiCustomModelApi(resolution)).toBe(PiModelApi.OpenAICompletions);
  resolution.config!.apiType = ApiFormat.Anthropic;
  expect(resolvePiCustomModelApi(resolution)).toBe(PiModelApi.AnthropicMessages);
  expect(resolvePiCustomModelApi({ config: null })).toBe(PiModelApi.OpenAICompletions);
});

function wireModel(resolution: ApiConfigResolution): Model<PiModelApi> {
  return {
    id: resolution.config!.model,
    name: resolution.config!.model,
    provider: resolution.providerMetadata!.providerName,
    api: resolvePiCustomModelApi(resolution),
    baseUrl: resolution.config!.baseURL,
    reasoning: false,
    input: ['text'],
    contextWindow: 32_768,
    maxTokens: 128,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

function mockWire(events: unknown[]): Request[] {
  const requests: Request[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }),
  );
  return requests;
}

test('the real Pi SDK sends non-catalog Gemini models to the native Google endpoint', async () => {
  const resolution = resolutionFor(ProviderName.Gemini, ApiFormat.Gemini);
  const requests = mockWire([
    {
      candidates: [
        { content: { role: 'model', parts: [{ text: 'GEMINI_OK' }] }, finishReason: 'STOP' },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    },
  ]);
  const result = await completeSimple(
    wireModel(resolution),
    {
      messages: [{ role: 'user', content: 'Hi', timestamp: 1 }],
    },
    { apiKey: MOCK_API_KEY, maxTokens: 32 },
  );

  expect(result.errorMessage).toBeUndefined();
  expect(result.content).toContainEqual({ type: 'text', text: 'GEMINI_OK' });
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0].url).pathname).toBe(
    `/v1beta/models/${EXTRA_MODEL_ID}:streamGenerateContent`,
  );
  expect(requests[0].headers.get('x-goog-api-key')).toBe(MOCK_API_KEY);
  const body = await requests[0].json();
  expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Hi' }] }]);
  expect(body.messages).toBeUndefined();
});

test('the real Pi SDK sends non-catalog OpenAI models through Responses like the settings test', async () => {
  const resolution = resolutionFor(ProviderName.OpenAI, ApiFormat.OpenAI);
  const item = {
    id: 'msg_mock',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'OPENAI_OK', annotations: [] }],
  };
  const requests = mockWire([
    { type: 'response.created', response: { id: 'resp_mock', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.output_text.delta', output_index: 0, delta: 'OPENAI_OK' },
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: { id: 'resp_mock', status: 'completed', output: [item] },
    },
  ]);
  const result = await completeSimple(
    wireModel(resolution),
    {
      messages: [{ role: 'user', content: 'Hi', timestamp: 1 }],
    },
    { apiKey: MOCK_API_KEY, maxTokens: 32 },
  );

  expect(result.errorMessage).toBeUndefined();
  expect(result.content).toContainEqual(
    expect.objectContaining({ type: 'text', text: 'OPENAI_OK' }),
  );
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0].url).pathname).toBe('/v1/responses');
  expect(requests[0].headers.get('authorization')).toBe(`Bearer ${MOCK_API_KEY}`);
  const body = await requests[0].json();
  expect(body.model).toBe(EXTRA_MODEL_ID);
  expect(body.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }]);
  expect(body.messages).toBeUndefined();
});
