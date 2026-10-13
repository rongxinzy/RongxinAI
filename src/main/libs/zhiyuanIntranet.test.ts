import { afterEach, expect, test, vi } from 'vitest';

import { ZhiyuanModelPool } from '../../shared/modelPool/constants';
import {
  probeZhiyuanIntranet,
  resetZhiyuanIntranetProbeForTests,
  zhiyuanIntranetApiKey,
} from './zhiyuanIntranet';

afterEach(() => {
  vi.unstubAllGlobals();
  resetZhiyuanIntranetProbeForTests();
});

test('intranet key round-trips through base64', () => {
  const key = zhiyuanIntranetApiKey();
  expect(key.startsWith('sk-')).toBe(true);
  expect(Buffer.from(key, 'utf8').toString('base64')).toBe(ZhiyuanModelPool.IntranetApiKeyBase64);
});

test('reports available when the gateway serves the intranet model', async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ data: [{ id: ZhiyuanModelPool.IntranetModelId }] }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(probeZhiyuanIntranet()).resolves.toBe(true);
  const request = new Request(String(fetchMock.mock.calls[0]?.[0]));
  expect(request.url).toBe(`${ZhiyuanModelPool.IntranetBaseUrl}/v1/models`);
  const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
  expect(headers.Authorization).toBe(`Bearer ${zhiyuanIntranetApiKey()}`);
});

test('reports unavailable when the gateway catalog misses the intranet model', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ data: [{ id: 'other-model' }] })),
  );

  await expect(probeZhiyuanIntranet()).resolves.toBe(false);
});

test('reports unavailable when the gateway is unreachable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network down');
    }),
  );

  await expect(probeZhiyuanIntranet()).resolves.toBe(false);
});

test('reports unavailable when the model catalog is empty', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ data: [] })),
  );

  await expect(probeZhiyuanIntranet()).resolves.toBe(false);
});

test('caches the probe result', async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ data: [{ id: ZhiyuanModelPool.IntranetModelId }] }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(probeZhiyuanIntranet()).resolves.toBe(true);
  await expect(probeZhiyuanIntranet()).resolves.toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
