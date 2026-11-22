import { afterEach, expect, test, vi } from 'vitest';
import { AISphere, AISphereError, AISphereStatus } from '../../../shared/aisphere';
import { ZhiyuanManagedProviderBridge } from '../../enterpriseExtension/managedProviderBridge';
import { resolvePiModel } from '../../libs/agentEngine/piMagpiePiModel';
import { getPiModules, type PiModelRuntime } from '../../libs/agentEngine/piRuntimeSessionState';
import type { MagpieModel, MagpieProviderSummary } from '../../../shared/magpie/types';
import { hostProviderPayload, type MagpieHostProvider } from '../../magpie/hostProviders';
import { ManagedMagpieProviderBindings } from '../../magpie/managedProviderBindings';
import {
  MAGPIE_DEFAULT_MODEL_ID_KEY,
  MAGPIE_RUNTIME_API_KEY,
  MagpieModelService,
} from '../../magpie/modelService';
import { AISphereService } from './service';
import { normalizePlatformAddress, parsePlatformModels } from './catalog';

const model = {
  name: 'model-a',
  url: 'http://inference.test/full/chat/completions',
  api_key: 'secret-a',
  tool_call: false,
  image: false,
  thinking: false,
  video: false,
  context_length: 262144,
  max_input: 0,
  max_output: 0,
};
const startTestGateway = async () => ({ baseUrl: 'http://127.0.0.1:1234', close: async () => {} });
function setup() {
  const values = new Map<string, unknown>();
  const store = {
    get: <T>(key: string) => values.get(key) as T | undefined,
    set: (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
  let catalog = [model];
  const fetcher = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith(AISphere.VerifyPath) ? { data: 'ok' } : { code: 0, model_list: catalog },
    ),
  );
  return {
    values,
    store,
    fetcher,
    service: new AISphereService(fetcher),
    setModels: (models: typeof catalog) => {
      catalog = models;
    },
  };
}
afterEach(() => vi.restoreAllMocks());

test('accepts HTTP and HTTPS origins, rejecting paths, credentials and query strings', () => {
  expect(normalizePlatformAddress(' https://127.0.0.1:123/ ')).toBe('https://127.0.0.1:123');
  expect(normalizePlatformAddress('http://example.test')).toBe('http://example.test');
  for (const address of [
    'file:///tmp/a',
    'https://user:pass@test',
    'https://test/v1',
    'https://test?key=x',
    'not a url',
  ]) {
    expect(() => normalizePlatformAddress(address)).toThrow(AISphereError.InvalidAddress);
  }
});

test('maps limits without treating zero as a zero allowance and rejects ambiguous catalogs', () => {
  const parsed = parsePlatformModels({ code: 0, model_list: [model] });
  expect(parsed[0]).toMatchObject({
    contextWindow: 262144,
    maxInput: undefined,
    maxTokens: undefined,
  });
  expect(() => parsePlatformModels({ code: 0, model_list: [model, model] })).toThrow();
  expect(() =>
    parsePlatformModels({ code: 0, model_list: [{ ...model, url: 'file:///tmp/model' }] }),
  ).toThrow();
  expect(() => parsePlatformModels({ code: 1, model_list: [model] })).toThrow();
});

test('starts closed and only exposes verified models, never their real key or endpoint', async () => {
  const { service, store, fetcher, values } = setup();
  await service.initialize(store, startTestGateway);
  expect(service.snapshot().status).toBe(AISphereStatus.Unconfigured);
  await expect(service.acquire(model.name)).rejects.toThrow();
  await service.connect('https://platform.test');
  expect(fetcher.mock.calls.map(call => call[0])).toEqual([
    'https://platform.test' + AISphere.VerifyPath,
    'https://platform.test' + AISphere.ModelsPath,
  ]);
  const visible = JSON.stringify([service.snapshot(), service.catalog(), [...values.entries()]]);
  expect(visible).not.toContain('secret-a');
  expect(visible).not.toContain('inference.test');
  expect(visible).not.toContain(service.token);
  expect(service.hostProvider()).toMatchObject({
    baseUrl: 'http://127.0.0.1:1234/v1',
    apiKey: service.token,
    models: [{ id: model.name, contextWindow: model.context_length, input: ['text'] }],
  });
});

test('invalid replacement preserves the previous binding and default model', async () => {
  const { service, store, fetcher, values } = setup();
  await service.initialize(store, startTestGateway);
  await service.connect('http://platform.test');
  fetcher.mockResolvedValueOnce(Response.json({ data: 'other' }));
  await expect(service.connect('http://other.test')).rejects.toThrow(AISphereError.InvalidPlatform);
  expect(values.get(AISphere.StoreKey)).toBe('http://platform.test');
  expect(service.snapshot().models[0].id).toBe(model.name);
});

test('directory refresh removes models and network failure cannot use old credentials', async () => {
  const { service, store, setModels, fetcher } = setup();
  await service.initialize(store, startTestGateway);
  await service.connect('http://platform.test');
  setModels([]);
  await service.refresh();
  await expect(service.acquire(model.name)).rejects.toThrow(AISphereError.MissingModel);
  fetcher.mockRejectedValue(new Error('offline'));
  await expect(service.refresh()).rejects.toThrow(AISphereError.Unavailable);
  expect(service.hostProvider()).toBeNull();
  await expect(service.acquire(model.name)).rejects.toThrow();
});

test('active requests and tasks block rebinding, successful switches invalidate gateway credentials', async () => {
  const { service, store } = setup();
  await service.initialize(store, startTestGateway);
  await service.connect('http://platform.test');
  const acquired = await service.acquire(model.name);
  await expect(service.connect('http://other.test')).rejects.toThrow(AISphereError.Busy);
  acquired.release();
  service.busy = () => true;
  await expect(service.connect('http://other.test')).rejects.toThrow(AISphereError.Busy);
  service.busy = () => false;
  const oldToken = service.token;
  await service.connect('http://other.test');
  expect(service.token).not.toBe(oldToken);
});

test('shutdown drains the listener being opened without publishing it', async () => {
  const { service, store } = setup();
  const opened = Promise.withResolvers<Awaited<ReturnType<typeof startTestGateway>>>();
  const start = vi.fn(() => opened.promise);
  await service.initialize(store, start);
  expect(start).not.toHaveBeenCalled();
  const connecting = expect(service.connect('http://platform.test')).rejects.toThrow(
    AISphereError.Unavailable,
  );
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  const stopped = service.shutdown();
  const close = vi.fn(async () => {});
  opened.resolve({ baseUrl: 'http://127.0.0.1:1234', close });
  await Promise.all([stopped, connecting]);
  expect(close).toHaveBeenCalledOnce();
  expect(service.hostProvider()).toBeNull();
});

test('parallel requests share a stale-directory refresh and cannot use removed models', async () => {
  const { service, store, fetcher, setModels } = setup();
  await service.initialize(store, startTestGateway);
  await service.connect('http://platform.test');
  const clock = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(clock + 31000);
  setModels([]);
  const results = await Promise.allSettled([
    service.acquire(model.name),
    service.acquire(model.name),
  ]);
  expect(results.every(result => result.status === 'rejected')).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

test('refresh cannot race a replacement connection and same-address reconnect retains selection', async () => {
  const { service, store, fetcher, values, setModels } = setup();
  await service.initialize(store, startTestGateway);
  await service.connect('http://platform.test');
  setModels([model, { ...model, name: 'selected' }]);
  let complete: (response: Response) => void = () => {};
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>(resolve => {
        complete = resolve;
      }),
  );
  const pending = service.connect('http://other.test');
  await Promise.resolve();
  await expect(service.refresh()).rejects.toThrow(AISphereError.Busy);
  complete(Response.json({ data: 'ok' }));
  await pending;
  const current = service.catalog().find(candidate => candidate.displayName === 'selected')!.id;
  values.set(MAGPIE_DEFAULT_MODEL_ID_KEY, current);
  await service.connect('http://other.test');
  expect(service.defaultModelRef()).toBe(current);
  const disconnected = await service.disconnect();
  expect(disconnected).toEqual({
    address: '',
    status: AISphereStatus.Unconfigured,
    models: [],
  });
  expect(values.get(AISphere.StoreKey)).toBe('');
  expect(values.get(MAGPIE_DEFAULT_MODEL_ID_KEY)).toBe('');
});

test('opens an existing binding without a canonical pin and publishes the selected organization ID to Pi', async () => {
  const { service, store, values, setModels } = setup();
  values.set(AISphere.StoreKey, 'http://platform.test');
  const legacyConfig = {
    model: { defaultModel: 'org/selected', defaultModelProvider: 'custom_aisphere' },
  };
  values.set('app_config', legacyConfig);
  setModels([model, { ...model, name: 'org/selected', image: true, max_output: 6144 }]);
  await service.initialize(store, startTestGateway);
  expect(values.has(MAGPIE_DEFAULT_MODEL_ID_KEY)).toBe(false);
  let managedProviders: readonly MagpieHostProvider[] = [];
  const sink = {
    syncHostProviders: vi.fn(async (providers: readonly MagpieHostProvider[]) => {
      managedProviders = providers;
    }),
  };
  const bindings = new ManagedMagpieProviderBindings(new ZhiyuanManagedProviderBridge(), sink, {
    organization: service,
  });
  const ordinary: MagpieModel = { id: 'personal/org/selected', owned_by: 'personal' };
  const models = new MagpieModelService(
    {
      status: () => ({ state: 'running', version: 'fixture', gatewayUrl: 'http://127.0.0.1:4321' }),
      models: async () => [
        ordinary,
        ...managedProviders.flatMap(provider =>
          provider.models.map(model => ({
            id: `${provider.id}/${model.id}`,
            owned_by: provider.id,
            display_name: model.name,
            context_window: model.contextWindow,
            max_output_tokens: model.maxTokens,
            modalities: { input: model.input ?? ['text'], output: ['text'] },
          })),
        ),
      ],
      providers: async () => [
        {
          id: 'personal',
          models: [ordinary.id],
          fallback: [service.defaultModelRef()],
        } as MagpieProviderSummary,
      ],
    },
    {
      readDefaultModelId: () => service.defaultModelRef(),
      writeDefaultModelId: id => store.set(MAGPIE_DEFAULT_MODEL_ID_KEY, id),
      beforeCatalog: () => bindings.beforeCatalog(),
      allowedModel: model => bindings.allowedModel(model.id, model.owned_by),
      allowProviderFallback: false,
    },
  );
  const catalog = await models.catalog();
  expect(catalog.models.map(model => model.id)).toEqual(service.catalog().map(model => model.id));
  expect(catalog.defaultModelId).toBe(service.catalog()[0].id);
  const [provider] = managedProviders;
  expect(provider.id).toBe(service.policy().providerKeys[0]);
  const payload = hostProviderPayload(provider);
  expect(payload.chat).toBe('http://127.0.0.1:1234/v1');
  expect(payload.key).toBe(service.token);
  expect(JSON.stringify(payload)).not.toContain('secret-a');
  const selected = service.catalog()[1].id;
  await models.selectDefault(selected);
  expect(values.get(MAGPIE_DEFAULT_MODEL_ID_KEY)).toBe(selected);
  expect(values.get('app_config')).toEqual(legacyConfig);
  expect(service.catalog()[1].isDefault).toBe(true);
  const runtime = {
    registerNativeProvider: vi.fn<PiModelRuntime['registerNativeProvider']>(),
    completeSimple: vi.fn(),
  };
  expect(
    (await resolvePiModel(await getPiModules(), models, undefined, runtime)).model,
  ).toMatchObject({
    id: selected,
    baseUrl: 'http://127.0.0.1:4321/v1',
    contextWindow: model.context_length,
    maxTokens: 6144,
    input: ['text', 'image'],
  });
  const native = runtime.registerNativeProvider.mock.calls[0]?.[0];
  expect(native?.id).toBe('magpie');
  await expect(
    native?.auth.apiKey?.resolve({
      ctx: { env: async () => undefined, fileExists: async () => false },
      signal: new AbortController().signal,
    }),
  ).resolves.toEqual({
    auth: { apiKey: MAGPIE_RUNTIME_API_KEY, baseUrl: 'http://127.0.0.1:4321/v1' },
  });
  await expect(models.resolve(ordinary.id)).rejects.toThrow('restricted');
  await service.connect('http://other.test');
  expect(service.catalog()[1].id).not.toBe(selected);
  await expect(models.resolve(selected)).rejects.toThrow('restricted');
  await service.disconnect();
  expect((await models.catalog()).models).toEqual([]);
  expect(sink.syncHostProviders).toHaveBeenLastCalledWith([], undefined);
});
