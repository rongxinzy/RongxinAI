import { expect, test, vi } from 'vitest';
import { ManagedMagpieProviderBindings } from './managedProviderBindings';
import { LOCAL_GPU_MAGPIE_PROVIDER_ID } from '../../shared/magpie/constants';
import { ZhiyuanManagedProviderBridge } from '../enterpriseExtension/managedProviderBridge';
import { buildLlamaCppRunningModelBinding } from '../libs/llamacppAgentBinding';
const model = buildLlamaCppRunningModelBinding({
  name: 'local-model',
  runtime_context_length: 8192,
})!;
test('publishes live GPU endpoint/model changes and removes unavailable models instead of preserving stale choices', async () => {
  const sink = { syncHostProviders: vi.fn(async () => {}) };
  const bindings = new ManagedMagpieProviderBindings(new ZhiyuanManagedProviderBridge(), sink, {
    readLocalModels: async () => {
      throw new Error('daemon stopped');
    },
  });
  bindings.setGpuSnapshot('http://127.0.0.1:1234/v1', [model]);
  expect(bindings.localGpuEligibility(`${LOCAL_GPU_MAGPIE_PROVIDER_ID}/${model.id}`)).toEqual(
    model.agentEligibility,
  );
  expect(bindings.localGpuEligibility(model.id)).toEqual(model.agentEligibility);
  await bindings.synchronize();
  expect(sink.syncHostProviders).toHaveBeenLastCalledWith(
    [
      expect.objectContaining({
        id: LOCAL_GPU_MAGPIE_PROVIDER_ID,
        baseUrl: 'http://127.0.0.1:1234/v1',
        models: [expect.objectContaining({ id: 'local-model' })],
      }),
    ],
    undefined,
  );
  bindings.setGpuSnapshot('http://127.0.0.1:2345/v1', [{ ...model, id: 'new-model' }]);
  expect(bindings.localGpuEligibility(model.id)).toBeUndefined();
  await bindings.synchronize();
  expect(sink.syncHostProviders.mock.calls.at(-1)?.[0]?.[0]).toMatchObject({
    baseUrl: 'http://127.0.0.1:2345/v1',
    models: [{ id: 'new-model' }],
  });
  await bindings.beforeCatalog();
  expect(sink.syncHostProviders).toHaveBeenLastCalledWith([], undefined);
  expect(bindings.localGpuEligibility('new-model')).toBeUndefined();
});
test('does not accept a network GPU endpoint or retain its previous model after rejection', async () => {
  const sink = { syncHostProviders: vi.fn(async () => {}) };
  const bindings = new ManagedMagpieProviderBindings(new ZhiyuanManagedProviderBridge(), sink);
  bindings.setGpuSnapshot('http://127.0.0.1:1234/v1', [model]);
  expect(() => bindings.setGpuSnapshot('https://external.example/v1', [model])).toThrow('loopback');
  await bindings.synchronize();
  expect(sink.syncHostProviders).toHaveBeenLastCalledWith([], undefined);
});

test('combines both host sources without losing enterprise restrictions when GPU is present', async () => {
  const enterprise = new ZhiyuanManagedProviderBridge();
  const definition = {
    id: 'zhiyuan-host-enterprise-fixture',
    name: 'Enterprise',
    api: 'openai-completions' as const,
    baseUrl: 'http://127.0.0.1:4321/v1',
    models: [{ id: 'ent-model' }],
  };
  vi.spyOn(enterprise, 'hostProviders').mockReturnValue([definition]);
  vi.spyOn(enterprise, 'allowedModel').mockImplementation(
    ref => ref === 'zhiyuan-host-enterprise-fixture/ent-model',
  );
  const sink = { syncHostProviders: vi.fn(async () => {}) };
  const bindings = new ManagedMagpieProviderBindings(enterprise, sink);
  bindings.setGpuSnapshot('http://127.0.0.1:1234/v1', [model]);
  await bindings.synchronize();
  expect(sink.syncHostProviders).toHaveBeenLastCalledWith(
    [definition, expect.objectContaining({ id: LOCAL_GPU_MAGPIE_PROVIDER_ID })],
    undefined,
  );
  expect(bindings.allowedModel('zhiyuan-host-local-gpu/local-model')).toBe(false);
  expect(bindings.allowedModel('zhiyuan-host-enterprise-fixture/ent-model')).toBe(true);
});

test('a GPU refresh abandoned by its gateway cannot publish a stale endpoint', async () => {
  const sink = { syncHostProviders: vi.fn(async () => {}) };
  const owner = new AbortController();
  const pending = Promise.withResolvers<{ baseUrl: string; models: (typeof model)[] }>();
  const bindings = new ManagedMagpieProviderBindings(new ZhiyuanManagedProviderBridge(), sink, {
    readLocalModels: () => pending.promise,
  });
  const refresh = bindings.beforeCatalog(owner.signal);
  owner.abort();
  pending.resolve({ baseUrl: 'http://127.0.0.1:1234/v1', models: [model] });
  await expect(refresh).rejects.toMatchObject({ name: 'AbortError' });
  expect(bindings.localGpuEligibility(model.id)).toBeUndefined();
  expect(sink.syncHostProviders).not.toHaveBeenCalled();
});
