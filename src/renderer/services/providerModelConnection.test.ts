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

test('reports each finished model through onResult before the batch completes', async () => {
  const fetchMock = vi.fn<
    (request: ConnectionFetchRequest) => Promise<ProviderModelConnectionTestResponse>
  >();
  vi.stubGlobal('window', { electron: { api: { fetch: fetchMock } } });

  let pendingRequests: PendingConnectionRequest[] = [];
  fetchMock.mockImplementation(
    () =>
      new Promise<ProviderModelConnectionTestResponse>(resolve => {
        pendingRequests.push({ resolve });
      }),
  );

  const seen: string[] = [];
  const resultsPromise = testProviderModelsConcurrently({
    ...input,
    models: models.slice(0, 4),
    onResult: ({ model, result }) => {
      seen.push(`${model.id}:${result.success}`);
    },
  });

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  expect(seen).toEqual([]);

  const resolveNext = (response: ProviderModelConnectionTestResponse) => {
    const [request, ...rest] = pendingRequests;
    pendingRequests = rest;
    request?.resolve(response);
  };

  resolveNext({ ok: false, status: 401, data: { error: { message: 'Invalid API key' } } });
  await vi.waitFor(() => expect(seen.length).toBe(1));
  expect(seen).toEqual(['model-0:false']);

  while (pendingRequests.length > 0) resolveNext({ ok: true, status: 200 });
  await vi.waitFor(() => expect(seen.length).toBe(4));
  expect(seen).toEqual(['model-0:false', 'model-1:true', 'model-2:true', 'model-3:true']);

  const results = await resultsPromise;
  expect(results.map(entry => entry.result.success)).toEqual([false, true, true, true]);
});

test('applies a bounded timeout to each connectivity request', async () => {
  const fetchMock = vi.fn<
    (request: ConnectionFetchRequest) => Promise<ProviderModelConnectionTestResponse>
  >(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal('window', { electron: { api: { fetch: fetchMock } } });

  await testProviderModelConnection({
    providerId: 'test-provider',
    provider,
    baseUrl: provider.baseUrl,
    apiFormat: ApiFormat.Anthropic,
    model: models[0],
  });

  const request = fetchMock.mock.calls[0]?.[0] as { timeoutMs?: number } | undefined;
  // 每个请求都必须带一个有界的超时，否则单个卡死的模型会拖住整批测试。
  expect(request?.timeoutMs).toBeGreaterThan(0);
  expect(request?.timeoutMs).toBeLessThanOrEqual(30_000);
});

test('keeps testing the remaining models when an onResult callback throws', async () => {
  const fetchMock = vi.fn<
    (request: ConnectionFetchRequest) => Promise<ProviderModelConnectionTestResponse>
  >(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal('window', { electron: { api: { fetch: fetchMock } } });

  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const seen: string[] = [];
  let thrown = 0;

  const results = await testProviderModelsConcurrently({
    ...input,
    models: models.slice(0, 3),
    onResult: ({ model }) => {
      seen.push(model.id);
      if (model.id === 'model-0') {
        thrown += 1;
        throw new Error('callback exploded');
      }
    },
  });

  // mockRestore 会清掉调用记录，先在恢复之前把日志次数取出来。
  const loggedErrorCount = consoleError.mock.calls.length;
  consoleError.mockRestore();

  // 回调是调用方的展示逻辑，它抛异常不能连累整批测试：剩下的模型照样要测完并返回结果。
  expect(thrown).toBe(1);
  expect([...seen].sort()).toEqual(['model-0', 'model-1', 'model-2']);
  expect(results.map(entry => entry.result.success)).toEqual([true, true, true]);
  expect(loggedErrorCount).toBeGreaterThan(0);
});
