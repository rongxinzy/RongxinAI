import { expect, test, vi } from 'vitest';

import { ManagedMagpieProviderBindings } from './managedProviderBindings';
import { STRATA_MAGPIE_PROVIDER_ID } from '../../shared/strata/constants';
import { ZhiyuanManagedProviderBridge } from '../enterpriseExtension/managedProviderBridge';

test('registers Strata on the configured non-8080 loopback port', async () => {
  const sink = { syncHostProviders: vi.fn(async () => {}) };
  const bindings = new ManagedMagpieProviderBindings(new ZhiyuanManagedProviderBridge(), sink);
  bindings.setExpectedStrataPort(8096);
  bindings.setStrataSnapshot({
    baseUrl: 'http://127.0.0.1:8096/v1',
    models: [{ id: 'strata-model', input: ['text'] }],
  });
  await bindings.synchronize();
  expect(sink.syncHostProviders).toHaveBeenLastCalledWith([
    expect.objectContaining({
      id: STRATA_MAGPIE_PROVIDER_ID,
      baseUrl: 'http://127.0.0.1:8096/v1',
    }),
  ]);
});

test('rejects Strata endpoints on the llama.cpp default port', () => {
  const sink = { syncHostProviders: vi.fn(async () => {}) };
  const bindings = new ManagedMagpieProviderBindings(new ZhiyuanManagedProviderBridge(), sink);
  bindings.setExpectedStrataPort(8096);
  expect(() =>
    bindings.setStrataSnapshot({
      baseUrl: 'http://127.0.0.1:8080/v1',
      models: [{ id: 'conflict', input: ['text'] }],
    }),
  ).toThrow('serve port');
});
