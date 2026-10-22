import { beforeEach, expect, test, vi } from 'vitest';
import { refreshMagpieModels, selectMagpieDefaultModel, toCatalogModel } from './availableModels';
import { store } from '../store';
import { LOCAL_GPU_MAGPIE_PROVIDER_ID } from '../../shared/magpie/constants';
const api = { catalog: vi.fn(), selectDefault: vi.fn(), start: vi.fn() };
const llamacpp = { listRunningModels: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
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
