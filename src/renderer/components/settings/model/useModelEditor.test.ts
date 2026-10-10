// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import {
  ApiFormat,
  ModelCapabilityStatus,
  ProviderModelConnectionTestStatus,
  ProviderModelOrigin,
  ProviderName,
  ProviderModelPiApi,
} from '../../../../shared/providers';
import { defaultConfig } from '../../../config';
import type { Model, ProvidersConfig, ProviderType } from './constants';
import { useModelEditor } from './useModelEditor';

vi.mock('../../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));

const verifiedModel: Model = {
  id: 'verified-model',
  name: 'Verified model',
  supportsImage: true,
  contextWindow: 128_000,
  maxTokens: 16_000,
  connectionTest: {
    status: ProviderModelConnectionTestStatus.Success,
    signature: 'existing-signature',
    testedAt: 123,
  },
};

function renderEditor(provider: ProviderType = 'custom_0') {
  return renderHook(() => {
    const [providers, setProviders] = useState<ProvidersConfig>({
      ...defaultConfig.providers,
      [provider]: {
        enabled: true,
        apiKey: 'mock-key',
        baseUrl: 'https://mock-provider.invalid/v1',
        apiFormat: ApiFormat.OpenAI,
        models: [verifiedModel, { id: 'other-model', name: 'Other model' }],
      },
    } as ProvidersConfig);
    return {
      providers,
      setProviders,
      ...useModelEditor({ providers, setProviders, activeProvider: provider }),
    };
  });
}

beforeEach(() => vi.restoreAllMocks());

test.each([
  ProviderName.Moonshot,
  ProviderName.Zhipu,
  'custom_0',
  ProviderName.Ollama,
] as ProviderType[])(
  '%s keeps verification when renaming a model without changing its ID',
  async provider => {
    const { result } = renderEditor(provider);
    // Ollama performs a runtime context lookup before opening its editor; edit
    // directly here to isolate persistence from that independent IPC lookup.
    if (provider === ProviderName.Ollama) {
      act(() => result.current.handleEditModel(verifiedModel.id, verifiedModel.name));
    } else {
      act(() => result.current.handleRowModelEdit(verifiedModel));
    }
    act(() => result.current.handleModelEditorDraftChange({ name: 'Renamed model' }));
    await act(async () => result.current.handleSaveNewModel());
    expect(result.current.providers[provider].models?.[0]).toMatchObject({
      id: verifiedModel.id,
      name: 'Renamed model',
      origin: ProviderModelOrigin.User,
      connectionTest: verifiedModel.connectionTest,
    });
  },
);

test('changing the model ID requires a new connection test', async () => {
  const { result } = renderEditor();
  act(() => result.current.handleEditModel(verifiedModel.id, verifiedModel.name));
  act(() => result.current.handleModelEditorDraftChange({ id: 'replacement-model' }));
  await act(async () => result.current.handleSaveNewModel());
  expect(result.current.providers.custom_0.models?.[0].id).toBe('replacement-model');
  expect(result.current.providers.custom_0.models?.[0].connectionTest).toBeUndefined();
});

test.each(Object.values(ProviderModelPiApi))(
  'changing a model API to %s clears its verification',
  async api => {
    const { result } = renderEditor();
    act(() => result.current.handleRowModelEdit(verifiedModel));
    act(() => result.current.handleModelEditorDraftChange({ piRuntime: { api } }));
    await act(async () => result.current.handleSaveNewModel());
    expect(result.current.providers.custom_0.models?.[0].connectionTest).toBeUndefined();
  },
);

test.each([ProviderName.Moonshot, ProviderName.OpenAI] as ProviderType[])(
  '%s keeps an explicit capability edit on a catalog model',
  async provider => {
    const catalogModel: Model = {
      id: provider === ProviderName.Moonshot ? 'kimi-k3' : 'gpt-4o',
      name: 'Catalog model',
      supportsImage: true,
      contextWindow: 128_000,
      maxTokens: 16_000,
    };
    const { result } = renderEditor(provider);
    act(() => {
      result.current.setProviders(current => ({
        ...current,
        [provider]: { ...current[provider], models: [catalogModel] },
      }));
    });
    act(() =>
      result.current.handleEditModel(
        catalogModel.id,
        catalogModel.name,
        catalogModel.supportsImage,
        undefined,
        undefined,
        catalogModel.contextWindow,
        catalogModel.maxTokens,
      ),
    );
    act(() =>
      result.current.handleModelEditorDraftChange({
        capabilities: {
          toolCalling: ModelCapabilityStatus.Unsupported,
          imageInput: ModelCapabilityStatus.Unsupported,
          videoInput: ModelCapabilityStatus.Supported,
          audioInput: ModelCapabilityStatus.Unsupported,
          documentInput: ModelCapabilityStatus.Supported,
          reasoning: ModelCapabilityStatus.Supported,
        },
      }),
    );
    await act(async () => result.current.handleSaveNewModel());
    expect(result.current.providers[provider].models?.[0]).toMatchObject({
      supportsImage: false,
      capabilities: {
        toolCalling: ModelCapabilityStatus.Unsupported,
        imageInput: ModelCapabilityStatus.Unsupported,
        videoInput: ModelCapabilityStatus.Supported,
        audioInput: ModelCapabilityStatus.Unsupported,
        documentInput: ModelCapabilityStatus.Supported,
        reasoning: ModelCapabilityStatus.Supported,
      },
    });
  },
);

test('capacity and capability edits keep the current ID verification', async () => {
  const { result } = renderEditor();
  act(() => result.current.handleRowModelEdit(verifiedModel));
  act(() =>
    result.current.handleModelEditorDraftChange({
      contextWindow: '64',
      maxTokens: '8',
      capabilities: { imageInput: ModelCapabilityStatus.Unsupported },
    }),
  );
  await act(async () => result.current.handleSaveNewModel());
  expect(result.current.providers.custom_0.models?.[0]).toMatchObject({
    contextWindow: 65_536,
    maxTokens: 8_192,
    supportsImage: false,
    connectionTest: verifiedModel.connectionTest,
  });
});

test('a new model starts unverified and preserves the other model entries', async () => {
  const { result } = renderEditor();
  act(() => result.current.handleAddModel());
  act(() => result.current.handleModelEditorDraftChange({ id: 'new-model', name: 'New model' }));
  await act(async () => result.current.handleSaveNewModel());
  const models = result.current.providers.custom_0.models!;
  expect(models).toHaveLength(3);
  expect(models[0]).toEqual(verifiedModel);
  expect(models[2]).toMatchObject({ id: 'new-model', origin: ProviderModelOrigin.User });
  expect(models[2].connectionTest).toBeUndefined();
});

test.each([
  { patch: { id: '', name: 'Name' }, error: 'modelNameAndIdRequired' },
  { patch: { id: 'new-model', name: '' }, error: 'modelNameAndIdRequired' },
  { patch: { id: 'other-model', name: 'Duplicate' }, error: 'modelIdExists' },
  {
    patch: { id: 'new-model', name: 'New', contextWindow: '-1' },
    error: 'modelContextWindowInvalid',
  },
  {
    patch: { id: 'new-model', name: 'New', maxTokens: 'invalid' },
    error: 'modelContextWindowInvalid',
  },
])('rejects invalid drafts without changing models: $error', async ({ patch, error }) => {
  const { result } = renderEditor();
  act(() => result.current.handleAddModel());
  act(() => result.current.handleModelEditorDraftChange(patch));
  await act(async () => result.current.handleSaveNewModel());
  expect(result.current.modelFormError).toBe(error);
  expect(result.current.providers.custom_0.models).toHaveLength(2);
  expect(result.current.providers.custom_0.models?.[0]).toEqual(verifiedModel);
});

test('confirming deletion preserves a model added in the same update batch', () => {
  const { result } = renderEditor();
  act(() => result.current.handleDeleteModel(verifiedModel.id));
  act(() => {
    result.current.setProviders(current => ({
      ...current,
      custom_0: {
        ...current.custom_0,
        models: [...current.custom_0.models!, { id: 'added-model', name: 'Added model' }],
      },
    }));
    result.current.confirmDeleteModel();
  });
  expect(result.current.providers.custom_0.models?.map(model => model.id)).toEqual([
    'other-model',
    'added-model',
  ]);
});

test('saving a rename preserves a model added in the same update batch', async () => {
  const { result } = renderEditor();
  act(() => result.current.handleEditModel(verifiedModel.id, verifiedModel.name));
  act(() => result.current.handleModelEditorDraftChange({ name: 'Renamed model' }));
  await act(async () => {
    result.current.setProviders(current => ({
      ...current,
      custom_0: {
        ...current.custom_0,
        models: [...current.custom_0.models!, { id: 'added-model', name: 'Added model' }],
      },
    }));
    await result.current.handleSaveNewModel();
  });
  expect(result.current.providers.custom_0.models?.map(model => model.id)).toEqual([
    verifiedModel.id,
    'other-model',
    'added-model',
  ]);
  expect(result.current.providers.custom_0.models?.[0].connectionTest).toEqual(
    verifiedModel.connectionTest,
  );
});
