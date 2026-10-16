import { expect, test, vi } from 'vitest';
import {
  ManagedMagpieProviderBindings,
  LOCAL_GPU_MAGPIE_PROVIDER_ID,
} from './managedProviderBindings';
import { ZhiyuanManagedProviderBridge } from '../enterpriseExtension/managedProviderBridge';
import { buildLlamaCppRunningModelBinding } from '../libs/llamacppAgentBinding';
const model = buildLlamaCppRunningModelBinding({
  name: 'local-model',
  runtime_context_length: 8192,
})!;
test('publishes live GPU endpoint/model changes and removes unavailable models instead of preserving stale choices', async () => {
  const sink = { syncHostProviders: vi.fn(async () => {}) };
  const bindings = new ManagedMagpieProviderBindings(new ZhiyuanManagedProviderBridge(), sink);
  bindings.setGpuSnapshot('http://127.0.0.1:1234/v1', [model]);
  await bindings.synchronize();
  expect(sink.syncHostProviders).toHaveBeenLastCalledWith([
    expect.objectContaining({
      id: LOCAL_GPU_MAGPIE_PROVIDER_ID,
      baseUrl: 'http://127.0.0.1:1234/v1',
      models: [expect.objectContaining({ id: 'local-model' })],
    }),
  ]);
  bindings.setGpuSnapshot('http://127.0.0.1:2345/v1', [{ ...model, id: 'new-model' }]);
  await bindings.synchronize();
  expect(sink.syncHostProviders.mock.calls.at(-1)?.[0]?.[0]).toMatchObject({
    baseUrl: 'http://127.0.0.1:2345/v1',
    models: [{ id: 'new-model' }],
  });
  bindings.setGpuReader(async () => {
    throw new Error('daemon stopped');
  });
  await bindings.beforeCatalog();
  expect(sink.syncHostProviders).toHaveBeenLastCalledWith([]);
});
test('does not accept a network GPU endpoint or retain its previous model after rejection', async () => {
  const sink = { syncHostProviders: vi.fn(async () => {}) };
  const bindings = new ManagedMagpieProviderBindings(new ZhiyuanManagedProviderBridge(), sink);
  bindings.setGpuSnapshot('http://127.0.0.1:1234/v1', [model]);
  expect(() => bindings.setGpuSnapshot('https://external.example/v1', [model])).toThrow('loopback');
  await bindings.synchronize();
  expect(sink.syncHostProviders).toHaveBeenLastCalledWith([]);
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
  expect(sink.syncHostProviders).toHaveBeenLastCalledWith([
    definition,
    expect.objectContaining({ id: LOCAL_GPU_MAGPIE_PROVIDER_ID }),
  ]);
  expect(bindings.allowedModel('zhiyuan-host-local-gpu/local-model')).toBe(false);
  expect(bindings.allowedModel('zhiyuan-host-enterprise-fixture/ent-model')).toBe(true);
});

test('keeps Ollama and local GPU in the same source set and removes only the failed runtime', async () => {
  const sink = { syncHostProviders: vi.fn(async () => {}) };
  const bindings = new ManagedMagpieProviderBindings(new ZhiyuanManagedProviderBridge(), sink);
  bindings.setGpuSnapshot('http://127.0.0.1:1234/v1', [model]);
  bindings.setOllamaSnapshot({
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: [{ id: 'ollama-model' }],
  });
  await bindings.synchronize();
  expect(sink.syncHostProviders.mock.lastCall?.[0]).toHaveLength(2);
  bindings.setOllamaReader(async () => {
    throw new Error('offline');
  });
  await bindings.beforeCatalog();
  expect(sink.syncHostProviders).toHaveBeenLastCalledWith([
    expect.objectContaining({ id: LOCAL_GPU_MAGPIE_PROVIDER_ID }),
  ]);
});

test('catalog refresh cannot resurrect an Ollama model explicitly stopped during its read', async () => {
  const sink = { syncHostProviders: vi.fn(async () => {}) };
  const bindings = new ManagedMagpieProviderBindings(new ZhiyuanManagedProviderBridge(), sink);
  let finish!: (snapshot: import('./ollamaProviderBinding').OllamaProviderSnapshot) => void;
  bindings.setOllamaReader(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const pending = bindings.beforeCatalog();
  bindings.setOllamaSnapshot({ baseUrl: null, models: [] });
  finish({ baseUrl: 'http://127.0.0.1:11434/v1', models: [{ id: 'stale' }] });
  await pending;
  expect(sink.syncHostProviders).toHaveBeenLastCalledWith([]);
});
