import {
  ApiFormat,
  ProviderModelConnectionFailureKind,
  type ProviderConfig,
} from '../../shared/providers';
import { afterEach, expect, test, vi } from 'vitest';

import { i18nService } from './i18n';

import {
  getProviderModelConnectionTestResult,
  PROVIDER_MODEL_CONNECTION_TEST_CONCURRENCY,
  testProviderModelConnection,
  testProviderModelsConcurrently,
  type ProviderModelConnectionTestResponse,
} from './providerModelConnection';

type ConnectionFetchRequest = {
  body?: string;
};

type PendingConnectionRequest = {
  resolve: (response: ProviderModelConnectionTestResponse) => void;
};

const models = Array.from({ length: 9 }, (_, index) => ({
  id: `model-${index}`,
  name: `Model ${index}`,
}));

const provider: ProviderConfig = {
  enabled: true,
  apiKey: 'test-api-key',
  baseUrl: 'https://provider.test',
};

const input = {
  providerId: 'test-provider',
  provider,
  baseUrl: provider.baseUrl,
  apiFormat: ApiFormat.Anthropic,
  models,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

test('tests models with bounded concurrency and preserves result order', async () => {
  const fetchMock = vi.fn<
    (request: ConnectionFetchRequest) => Promise<ProviderModelConnectionTestResponse>
  >();
  vi.stubGlobal('window', { electron: { api: { fetch: fetchMock } } });

  let activeRequests = 0;
  let maxActiveRequests = 0;
  let pendingRequests: PendingConnectionRequest[] = [];

  fetchMock.mockImplementation(() => {
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    return new Promise<ProviderModelConnectionTestResponse>(resolve => {
      pendingRequests.push({ resolve: response => { activeRequests -= 1; resolve(response); } });
    });
  });

  const resultsPromise = testProviderModelsConcurrently(input);

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  expect(activeRequests).toBe(PROVIDER_MODEL_CONNECTION_TEST_CONCURRENCY);
  expect(maxActiveRequests).toBe(PROVIDER_MODEL_CONNECTION_TEST_CONCURRENCY);

  const resolvePendingRequests = (count: number) => {
    const requests = pendingRequests.slice(0, count);
    pendingRequests = pendingRequests.slice(count);
    for (const request of requests) {
      request.resolve({ ok: true, status: 200 });
    }
  };

  resolvePendingRequests(4);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8));
  resolvePendingRequests(4);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(9));
  resolvePendingRequests(1);

  const results = await resultsPromise;

  expect(results.map(result => result.model.id)).toEqual(models.map(model => model.id));
  expect(results.every(result => result.result.success)).toBe(true);
  expect(maxActiveRequests).toBeLessThanOrEqual(PROVIDER_MODEL_CONNECTION_TEST_CONCURRENCY);
});

test('treats a model output limit response as successful connectivity', () => {
  expect(
    getProviderModelConnectionTestResult({
      ok: false,
      status: 400,
      data: { error: { message: 'Model output limit was reached' } },
    }),
  ).toEqual({ success: true });
});

test('returns the provider error message for a failed connectivity test', () => {
  expect(
    getProviderModelConnectionTestResult({
      ok: false,
      status: 401,
      data: { error: { message: 'Invalid API key' } },
    }),
  ).toEqual({
    success: false,
    message: 'Invalid API key',
    failureKind: ProviderModelConnectionFailureKind.Auth,
  });
});
test('returns a localized timeout as a network failure', () => {
  expect(
    getProviderModelConnectionTestResult({
      ok: false,
      status: 0,
      error: 'aborted due to timeout',
    }),
  ).toEqual({
    success: false,
    message: i18nService.t('modelConnectionTestTimeout'),
    failureKind: ProviderModelConnectionFailureKind.Network,
  });
});
test('classifies connection test failures by provider response', () => {
  const result = (status: number, message: string) =>
    getProviderModelConnectionTestResult({ ok: false, status, data: { error: { message } } });

  expect(result(403, 'Forbidden')).toMatchObject({
    failureKind: ProviderModelConnectionFailureKind.Auth,
  });
  expect(result(429, 'Too many requests')).toMatchObject({
    failureKind: ProviderModelConnectionFailureKind.RateLimit,
  });
  expect(result(503, 'Service unavailable')).toMatchObject({
    failureKind: ProviderModelConnectionFailureKind.Server,
  });
  expect(result(404, 'model not found')).toMatchObject({
    failureKind: ProviderModelConnectionFailureKind.Model,
  });
  expect(result(400, 'Invalid request')).toMatchObject({
    failureKind: ProviderModelConnectionFailureKind.Unknown,
  });
});

test('classifies thrown connection test errors as network failures', async () => {
  vi.stubGlobal('window', {
    electron: {
      api: {
        fetch: vi.fn(async () => {
          throw new Error('network unreachable');
        }),
      },
    },
  });

  await expect(
    testProviderModelConnection({
      providerId: 'test-provider',
      provider,
      baseUrl: provider.baseUrl,
      apiFormat: ApiFormat.Anthropic,
      model: models[0],
    }),
  ).resolves.toMatchObject({
    message: 'network unreachable',
    failureKind: ProviderModelConnectionFailureKind.Network,
  });
});
