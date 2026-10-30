import { beforeEach, expect, test, vi } from 'vitest';
import { refreshMagpieModels, selectMagpieDefaultModel, toCatalogModel } from './availableModels';
import { store } from '../store';
import { LOCAL_GPU_MAGPIE_PROVIDER_ID } from '../../shared/magpie/constants';
import type { MagpieProviderSummary } from '../../shared/magpie/types';
import { setSelectedModel } from '../store/slices/modelSlice';
const api = { catalog: vi.fn(), selectDefault: vi.fn(), start: vi.fn(), providers: vi.fn() };
const llamacpp = { listRunningModels: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  api.providers.mockResolvedValue([]);
  llamacpp.listRunningModels.mockResolvedValue([]);
  vi.stubGlobal('window', { electron: { magpie: api, llamacpp } });
});
const catalog = {
  status: { state: 'running', version: '1' },
  models: [
    {
      id: 'vendor/model',
      display_name: 'Model',
      native_endpoints: ['anthropic'],
      modalities: { input: ['text', 'image'], output: ['text'] },
    },
  ],
  defaultModelId: 'vendor/model',
};
test('uses exact catalog ids and image metadata without constructing provider paths', () => {
  expect(toCatalogModel(catalog.models[0])).toMatchObject({
    id: 'vendor/model',
    name: 'Model',
    supportsImage: true,
  });
});
test('loads catalog without starting and sets only confirmed default', async () => {
  api.catalog.mockResolvedValue(catalog);
  await refreshMagpieModels();
  expect(api.start).not.toHaveBeenCalled();
  expect(store.getState().model.defaultSelectedModel.id).toBe('vendor/model');
  api.catalog.mockResolvedValue({ ...catalog, defaultModelId: null });
  await refreshMagpieModels();
  expect(store.getState().model.defaultSelectedModel.id).toBe('');
});
test('forwards exact default id and never commits a rejected selection', async () => {
  api.catalog.mockResolvedValue(catalog);
  await refreshMagpieModels();
  api.selectDefault.mockRejectedValue(new Error('failed'));
  await expect(selectMagpieDefaultModel('other/model')).rejects.toThrow('failed');
  expect(api.selectDefault).toHaveBeenCalledWith('other/model');
  expect(store.getState().model.defaultSelectedModel.id).toBe('vendor/model');
});
test('stopped service removes stale selectable models', async () => {
  api.catalog.mockResolvedValue({ ...catalog, status: { state: 'stopped', version: '1' } });
  await refreshMagpieModels();
  expect(store.getState().model.availableModels).toEqual([]);
  expect(store.getState().model.defaultSelectedModel.id).toBe('');
});

test('a refresh overlapping a default write cannot restore the old default', async () => {
  let resolveRead!: (value: typeof catalog) => void;
  let resolveWrite!: (value: typeof catalog) => void;
  api.selectDefault.mockImplementation(
    () =>
      new Promise(resolve => {
        resolveWrite = resolve;
      }),
  );
  api.catalog.mockImplementation(
    () =>
      new Promise(resolve => {
        resolveRead = resolve;
      }),
  );
  const saving = selectMagpieDefaultModel('vendor/model');
  const refreshing = refreshMagpieModels();
  resolveWrite(catalog);
  await saving;
  resolveRead({ ...catalog, defaultModelId: 'removed/model' });
  await refreshing;
  expect(store.getState().model.defaultSelectedModel.id).toBe('vendor/model');
});

test('running local models carry their agent eligibility so the picker can offer them', async () => {
  llamacpp.listRunningModels.mockResolvedValue([
    { name: 'big-ctx', runtime_context_length: 65536, trained_context_length: 131072 },
    { name: 'tiny-ctx', runtime_context_length: 2048, trained_context_length: 2048 },
  ]);
  const local = (id: string) => ({ id, owned_by: LOCAL_GPU_MAGPIE_PROVIDER_ID });
  api.catalog.mockResolvedValue({
    ...catalog,
    models: [
      ...catalog.models,
      local(`${LOCAL_GPU_MAGPIE_PROVIDER_ID}/big-ctx`),
      local('tiny-ctx'),
      { id: 'big-ctx', owned_by: 'vendor' },
    ],
  });
  await refreshMagpieModels();
  const byKey = store
    .getState()
    .model.availableModels.map(model => [
      model.id,
      model.providerKey,
      model.llamaCppAgentEligibility?.eligible,
    ]);
  expect(byKey).toEqual([
    ['vendor/model', undefined, undefined],
    [`${LOCAL_GPU_MAGPIE_PROVIDER_ID}/big-ctx`, LOCAL_GPU_MAGPIE_PROVIDER_ID, true],
    ['tiny-ctx', LOCAL_GPU_MAGPIE_PROVIDER_ID, false],
    ['big-ctx', 'vendor', undefined],
  ]);
});

test('an unavailable local service leaves the catalog without local eligibility', async () => {
  llamacpp.listRunningModels.mockRejectedValue(new Error('down'));
  api.catalog.mockResolvedValue(catalog);
  await refreshMagpieModels();
  expect(store.getState().model.availableModels[0]?.llamaCppAgentEligibility).toBeUndefined();
});

const provider: MagpieProviderSummary = {
  id: 'provider-generated-id',
  name: 'Zhipu GLM',
  api: 'openai-completions',
  baseUrl: 'https://example.com/v1',
  models: ['GLM-5.3-Flash'],
  off: false,
  hasKey: true,
};
const namedCatalog = {
  ...catalog,
  models: [{ id: 'GLM-5.3-Flash', owned_by: provider.id }],
  defaultModelId: 'GLM-5.3-Flash',
};

test('shows supplier names while preserving exact model and routing identities', async () => {
  api.providers.mockResolvedValue([provider]);
  api.catalog.mockResolvedValue(namedCatalog);
  await refreshMagpieModels();
  expect(store.getState().model.defaultSelectedModel).toMatchObject({
    id: 'GLM-5.3-Flash',
    provider: provider.name,
    providerKey: provider.id,
  });
  api.selectDefault.mockResolvedValue(namedCatalog);
  await selectMagpieDefaultModel('GLM-5.3-Flash');
  expect(api.selectDefault).toHaveBeenCalledExactlyOnceWith('GLM-5.3-Flash');
  expect(store.getState().model.defaultSelectedModel.provider).toBe(provider.name);
});

test('a renamed supplier refreshes default and agent labels without changing selections', async () => {
  api.providers.mockResolvedValue([provider]);
  api.catalog.mockResolvedValue(namedCatalog);
  await refreshMagpieModels();
  store.dispatch(
    setSelectedModel({
      agentId: 'test-agent',
      model: store.getState().model.defaultSelectedModel,
    }),
  );
  api.providers.mockResolvedValue([{ ...provider, name: 'Renamed supplier' }]);
  await refreshMagpieModels();
  const state = store.getState().model;
  expect(state.defaultSelectedModel).toMatchObject({
    id: namedCatalog.defaultModelId,
    provider: 'Renamed supplier',
    providerKey: provider.id,
  });
  expect(state.selectedModelByAgent['test-agent']).toEqual(state.defaultSelectedModel);
});

test('unknown or blank supplier names preserve the owner, including built-in providers', () => {
  for (const providers of [[], [{ ...provider, name: '  ' }]]) {
    expect(toCatalogModel(namedCatalog.models[0], providers).provider).toBe(provider.id);
    expect(
      toCatalogModel({ id: 'local', owned_by: LOCAL_GPU_MAGPIE_PROVIDER_ID }, providers).provider,
    ).toBe(LOCAL_GPU_MAGPIE_PROVIDER_ID);
    expect(toCatalogModel({ id: 'unowned' }, providers).provider).toBeUndefined();
  }
});

test('supplier metadata failure does not discard models or a confirmed default', async () => {
  api.catalog.mockResolvedValue(namedCatalog);
  api.providers.mockRejectedValue(new Error('metadata unavailable'));
  await refreshMagpieModels();
  expect(store.getState().model.availableModels[0]?.provider).toBe(provider.id);
  api.selectDefault.mockResolvedValue(namedCatalog);
  await selectMagpieDefaultModel(namedCatalog.defaultModelId);
  expect(store.getState().model.defaultSelectedModel.id).toBe(namedCatalog.defaultModelId);
});

test('an older supplier read cannot replace the labels from a newer refresh', async () => {
  let finishOld!: (value: MagpieProviderSummary[]) => void;
  api.catalog.mockResolvedValue(namedCatalog);
  api.providers.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishOld = resolve;
      }),
  );
  const older = refreshMagpieModels();
  api.providers.mockResolvedValue([{ ...provider, name: 'New supplier name' }]);
  await refreshMagpieModels();
  finishOld([provider]);
  await older;
  expect(store.getState().model.defaultSelectedModel.provider).toBe('New supplier name');
});
