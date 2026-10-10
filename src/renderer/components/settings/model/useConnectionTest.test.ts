// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import {
  ApiFormat,
  ProviderModelConnectionFailureKind,
  ProviderModelConnectionTestStatus,
  ProviderName,
  ProviderModelPiApi,
  ProviderRegistry,
  type DiscoveredProviderModel,
} from '../../../../shared/providers';
import { defaultConfig, type AppConfig } from '../../../config';
import type {
  ProviderModelConnectionTestEntry,
  ProviderModelConnectionTestResult,
  testProviderModelsConcurrently,
} from '../../../services/providerModelConnection';
import type { ConfigService } from '../../../services/config';
import { ModelConnectionStatus } from '../useModelConnectionStatus';
import type { ProviderConfig, ProvidersConfig, ProviderType } from './constants';
import { useConnectionTest } from './useConnectionTest';

const mocks = vi.hoisted(() => ({
  signature: vi.fn(),
  single: vi.fn(),
  batch: vi.fn(),
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock('../../../../shared/providers', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../shared/providers')>()),
  createProviderConnectionTestSignature: mocks.signature,
}));
vi.mock('../../../services/config', () => ({
  configService: { getConfig: mocks.getConfig, updateConfig: mocks.updateConfig },
}));
vi.mock('../../../services/providerModelConnection', () => ({
  testProviderModelConnection: mocks.single,
  testProviderModelsConcurrently: mocks.batch,
}));
vi.mock('../../../services/i18n', () => ({
  i18nService: { t: (key: string) => key, getLanguage: () => 'en' },
}));

type BatchInput = Parameters<typeof testProviderModelsConcurrently>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const discovered: DiscoveredProviderModel[] = Array.from({ length: 5 }, (_, index) => ({
  id: `model-${index + 1}`,
  displayName: `Model ${index + 1}`,
}));
const initialModels = discovered.map(model => ({ id: model.id, name: model.displayName! }));

function renderConnection(
  provider: ProviderType = ProviderName.Moonshot,
  patch: Partial<ProviderConfig> = {},
) {
  const initialProviders = {
    ...defaultConfig.providers,
    [provider]: {
      enabled: false,
      apiKey: 'mock-api-key',
      baseUrl: 'https://mock-provider.invalid/v1',
      apiFormat: ApiFormat.OpenAI,
      models: initialModels,
      ...patch,
    },
  } as ProvidersConfig;
  let savedConfig: AppConfig = { ...defaultConfig, providers: initialProviders };
  mocks.getConfig.mockImplementation(() => savedConfig);
  mocks.updateConfig.mockImplementation(
    async (update: Parameters<ConfigService['updateConfig']>[0]) => {
      const patchConfig = typeof update === 'function' ? update(savedConfig) : update;
      if (patchConfig) savedConfig = { ...savedConfig, ...patchConfig };
    },
  );
  const requestRef: { current: Partial<Record<ProviderType, number>> } = { current: {} };
  const callbacks = {
    enable: vi.fn(),
    singleStatus: vi.fn(),
    mergeStatuses: vi.fn(),
    replaceStatuses: vi.fn(),
  };
  const hook = renderHook(() => {
    const [providers, setProviders] = useState(initialProviders);
    const [selectedModelId, setSelectedModelId] = useState('model-1');
    return {
      providers,
      setProviders,
      selectedModelId,
      ...useConnectionTest({
        providers,
        setProviders,
        activeProvider: provider,
        selectedModelId,
        setSelectedModelId,
        enableProvider: callbacks.enable,
        modelConnectionTestRequestIdRef: requestRef,
        setModelConnectionStatus: callbacks.singleStatus,
        mergeProviderModelConnectionStatuses: callbacks.mergeStatuses,
        setProviderModelConnectionStatuses: callbacks.replaceStatuses,
      }),
    };
  });
  // Simulate the settings page save button persisting the current form draft
  // to storage while a connection test is still in flight.
  const saveFormToStorage = (providers: ProvidersConfig) => {
    savedConfig = { ...savedConfig, providers };
  };
  return {
    ...hook,
    requestRef,
    callbacks,
    saved: () => savedConfig.providers![provider],
    saveFormToStorage,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.signature.mockResolvedValue('mock-signature');
  mocks.single.mockResolvedValue({ success: true });
  mocks.batch.mockImplementation(async (input: BatchInput) =>
    input.models.map(model => {
      const entry: ProviderModelConnectionTestEntry = { model, result: { success: true } };
      input.onResult?.(entry);
      return entry;
    }),
  );
});

test.each(['single', 'batch'] as const)(
  '%s ignores a result after the model API changes',
  async mode => {
    const network = deferred<ProviderModelConnectionTestEntry[]>();
    mocks.single.mockImplementation(async () => (await network.promise)[0].result);
    mocks.batch.mockReturnValue(network.promise);
    const { result, saved } = renderConnection('custom_0');
    let pending: Promise<void>;
    await act(async () => {
      pending =
        mode === 'single'
          ? result.current.handleTestConnection()
          : result.current.handleModelsDiscovered('custom_0', discovered);
    });
    act(() =>
      result.current.setProviders(current => ({
        ...current,
        custom_0: {
          ...current.custom_0,
          models: current.custom_0.models?.map(model => ({
            ...model,
            piRuntime: { api: ProviderModelPiApi.AnthropicMessages },
          })),
        },
      })),
    );
    await act(async () => {
      network.resolve(initialModels.map(model => ({ model, result: { success: true } })));
      await pending;
    });
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    expect(saved().models?.every(model => !model.connectionTest)).toBe(true);
  },
);

test('a queued write rechecks the current request before changing saved configuration', async () => {
  const { result, requestRef } = renderConnection();
  let queued: Parameters<ConfigService['updateConfig']>[0] | undefined;
  const gate = deferred<void>();
  mocks.updateConfig.mockImplementation(async update => {
    queued = update;
    await gate.promise;
  });
  let pending: Promise<void>;
  await act(async () => {
    pending = result.current.handleTestConnection();
  });
  expect(typeof queued).toBe('function');
  requestRef.current.moonshot = (requestRef.current.moonshot ?? 0) + 1;
  expect(typeof queued === 'function' ? queued(mocks.getConfig()) : queued).toBeUndefined();
  await act(async () => {
    gate.resolve();
    await pending;
  });
});

const remoteProviders = [
  ...Object.values(ProviderName).filter(
    provider => provider !== ProviderName.LlamaCpp && provider !== ProviderName.Custom,
  ),
  'custom_0',
] as ProviderType[];

test.each(remoteProviders)('%s saves all five tested models after discovery', async provider => {
  const { result, saved, callbacks } = renderConnection(provider, { models: [] });
  await act(async () => {
    await result.current.handleModelsDiscovered(provider, discovered);
  });
  await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledTimes(1));
  // The merge only writes connectionTest verdicts and newly discovered
  // models; it never flips stored fields such as enabled by itself.
  expect(saved().enabled).toBe(false);
  expect(saved().models?.map(model => model.id)).toEqual(discovered.map(model => model.id));
  expect(
    saved().models?.every(
      model => model.connectionTest?.status === ProviderModelConnectionTestStatus.Success,
    ),
  ).toBe(true);
  expect(result.current.providers[provider].models).toEqual(saved().models);
  expect(callbacks.replaceStatuses).toHaveBeenCalledWith(
    provider,
    Object.fromEntries(discovered.map(model => [model.id, ModelConnectionStatus.Success])),
  );
});

test.each(
  ProviderRegistry.providerIds.filter(provider => ProviderRegistry.supportsCodingPlan(provider)),
)('%s preserves coding plan mode when the full batch is saved', async providerId => {
  const provider = providerId as ProviderType;
  const { result, saved } = renderConnection(provider, { codingPlanEnabled: true });
  await act(async () => {
    await result.current.handleModelsDiscovered(provider, discovered);
  });
  await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledOnce());
  expect(saved().codingPlanEnabled).toBe(true);
  expect(saved().models).toHaveLength(5);
  expect(mocks.batch.mock.calls[0][0].provider.codingPlanEnabled).toBe(true);
});

test('a single test persists the complete list and only marks the requested model', async () => {
  const { result, saved } = renderConnection();
  await act(async () => result.current.handleTestConnection('model-3'));
  expect(saved().models).toHaveLength(5);
  expect(saved().models?.map(model => model.connectionTest?.status)).toEqual([
    undefined,
    undefined,
    ProviderModelConnectionTestStatus.Success,
    undefined,
    undefined,
  ]);
  expect(mocks.single.mock.calls[0][0].model.id).toBe('model-3');
});

test('a successful single test does not force enabled or rewrite stored provider fields', async () => {
  const { result, saved } = renderConnection();
  await act(async () => result.current.handleTestConnection('model-3'));
  // The incremental merge only writes connectionTest verdicts; enabled,
  // baseUrl, apiFormat and untested models stay exactly as stored.
  expect(saved().enabled).toBe(false);
  expect(saved().baseUrl).toBe('https://mock-provider.invalid/v1');
  expect(saved().apiFormat).toBe(ApiFormat.OpenAI);
  expect(saved().models?.filter(model => model.connectionTest !== undefined)).toHaveLength(1);
});

test('a stored model removed from storage while testing is not resurrected', async () => {
  const batch = deferred<ProviderModelConnectionTestEntry[]>();
  mocks.batch.mockReturnValue(batch.promise);
  const { result, saved, saveFormToStorage } = renderConnection();
  let pending: Promise<void>;
  await act(async () => {
    pending = result.current.handleModelsDiscovered(ProviderName.Moonshot, discovered);
  });
  // The user deletes model-2 from the form and saves while the batch runs.
  act(() =>
    result.current.setProviders(current => ({
      ...current,
      moonshot: {
        ...current.moonshot,
        models: [current.moonshot.models![0], ...current.moonshot.models!.slice(2)],
      },
    })),
  );
  act(() => saveFormToStorage(result.current.providers));
  await act(async () => {
    batch.resolve(initialModels.map(model => ({ model, result: { success: true } })));
    await pending;
  });
  await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledOnce());
  expect(saved().models?.map(model => model.id)).toEqual([
    'model-1',
    'model-3',
    'model-4',
    'model-5',
  ]);
  expect(
    saved().models?.every(
      model => model.connectionTest?.status === ProviderModelConnectionTestStatus.Success,
    ),
  ).toBe(true);
});

test('single failures persist their classification without enabling a provider', async () => {
  mocks.single.mockResolvedValue({
    success: false,
    message: 'Rate limited',
    failureKind: ProviderModelConnectionFailureKind.RateLimit,
  });
  const { result, saved, callbacks } = renderConnection(ProviderName.Moonshot, { enabled: true });
  await act(async () => result.current.handleTestConnection());
  expect(saved().models?.[0].connectionTest).toMatchObject({
    status: ProviderModelConnectionTestStatus.Failure,
    failureKind: ProviderModelConnectionFailureKind.RateLimit,
  });
  expect(callbacks.enable).not.toHaveBeenCalled();
});

test.each(['single', 'batch'] as const)(
  '%s merges verdicts into the latest saved draft without touching other stored fields',
  async mode => {
    const single = deferred<ProviderModelConnectionTestResult>();
    const batch = deferred<ProviderModelConnectionTestEntry[]>();
    mocks.single.mockReturnValue(single.promise);
    mocks.batch.mockReturnValue(batch.promise);
    const { result, saved, saveFormToStorage } = renderConnection();
    let pending: Promise<void>;
    await act(async () => {
      pending =
        mode === 'single'
          ? result.current.handleTestConnection()
          : result.current.handleModelsDiscovered(ProviderName.Moonshot, discovered);
    });
    // While the test is in flight the user edits the form and hits save:
    // storage now holds the edited draft, including a deleted and an added
    // model. A late test verdict must merge into THIS state, not overwrite
    // it with the form snapshot taken when the test started.
    act(() =>
      result.current.setProviders(current => ({
        ...current,
        moonshot: {
          ...current.moonshot,
          displayName: 'Edited provider',
          models: [
            { ...current.moonshot.models![0], name: 'Edited model', maxTokens: 8192 },
            ...current.moonshot.models!.slice(2),
            { id: 'added-during-test', name: 'New model' },
          ],
        },
      })),
    );
    act(() => saveFormToStorage(result.current.providers));
    await act(async () => {
      single.resolve({ success: true });
      batch.resolve(initialModels.map(model => ({ model, result: { success: true } })));
      await pending;
    });
    await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledOnce());
    expect(saved().displayName).toBe('Edited provider');
    expect(saved().models?.map(model => model.id)).toEqual([
      'model-1',
      'model-3',
      'model-4',
      'model-5',
      'added-during-test',
    ]);
    expect(saved().models?.[0]).toMatchObject({ name: 'Edited model', maxTokens: 8192 });
    // model-2 was deleted before the save, so its late verdict is dropped
    // instead of resurrecting the model; the model added during the test was
    // never probed and stays without a verdict.
    expect(saved().models?.some(model => model.id === 'model-2')).toBe(false);
    expect(saved().models?.at(-1)?.connectionTest).toBeUndefined();
    // Untested stored models keep their saved shape untouched.
    expect(saved().models?.[1]).toMatchObject({ id: 'model-3', name: 'Model 3' });
    expect(result.current.providers.moonshot.models).toEqual(saved().models);
  },
);

test.each(['single', 'batch'] as const)(
  '%s ignores results invalidated while calculating the signature',
  async mode => {
    const signature = deferred<string>();
    mocks.signature.mockReturnValue(signature.promise);
    const { result, requestRef } = renderConnection();
    let pending: Promise<void>;
    await act(async () => {
      pending =
        mode === 'single'
          ? result.current.handleTestConnection()
          : result.current.handleModelsDiscovered(ProviderName.Moonshot, discovered);
    });
    requestRef.current.moonshot = (requestRef.current.moonshot ?? 0) + 1;
    await act(async () => {
      signature.resolve('stale-signature');
      await pending;
    });
    expect(mocks.single).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  },
);

test.each([
  { apiKey: 'new-mock-key' },
  { baseUrl: 'https://changed.invalid/v1' },
  { apiFormat: ApiFormat.Anthropic },
  { codingPlanEnabled: true },
  { authType: 'oauth' as const },
  { oauthAccessToken: 'new-mock-token' },
])('ignores a single result when connection inputs change: %j', async patch => {
  const response = deferred<ProviderModelConnectionTestResult>();
  mocks.single.mockReturnValue(response.promise);
  const { result, callbacks } = renderConnection();
  let pending: Promise<void>;
  await act(async () => {
    pending = result.current.handleTestConnection();
  });
  act(() =>
    result.current.setProviders(current => ({
      ...current,
      moonshot: { ...current.moonshot, ...patch },
    })),
  );
  await act(async () => {
    response.resolve({ success: true });
    await pending;
  });
  expect(mocks.updateConfig).not.toHaveBeenCalled();
  expect(callbacks.singleStatus).not.toHaveBeenCalled();
  expect(result.current.providers.moonshot).toMatchObject(patch);
});

test('a superseded batch cannot overwrite statuses or persist its models', async () => {
  const oldBatch = deferred<ProviderModelConnectionTestEntry[]>();
  mocks.batch.mockReturnValueOnce(oldBatch.promise);
  const { result, callbacks } = renderConnection('custom_0', { models: [] });
  await act(async () => result.current.handleModelsDiscovered('custom_0', discovered));
  const oldInput = mocks.batch.mock.calls[0][0] as BatchInput;
  await act(async () => result.current.handleModelsDiscovered('custom_0', [{ id: 'fresh-model' }]));
  await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledOnce());
  callbacks.mergeStatuses.mockClear();
  callbacks.replaceStatuses.mockClear();
  await act(async () => {
    const entry: ProviderModelConnectionTestEntry = {
      model: initialModels[0],
      result: { success: true },
    };
    oldInput.onResult?.(entry);
    oldBatch.resolve([entry]);
  });
  expect(result.current.providers.custom_0.models?.map(model => model.id)).toEqual(['fresh-model']);
  expect(mocks.updateConfig).toHaveBeenCalledOnce();
  expect(callbacks.replaceStatuses).not.toHaveBeenCalled();
});

test('a deleted provider is not recreated by a pending connection result', async () => {
  const response = deferred<ProviderModelConnectionTestResult>();
  mocks.single.mockReturnValue(response.promise);
  const { result } = renderConnection('custom_0');
  let pending: Promise<void>;
  await act(async () => {
    pending = result.current.handleTestConnection();
  });
  act(() =>
    result.current.setProviders(current => {
      const next = { ...current };
      delete next.custom_0;
      return next;
    }),
  );
  await act(async () => {
    response.resolve({ success: true });
    await pending;
  });
  expect(result.current.providers.custom_0).toBeUndefined();
  expect(mocks.updateConfig).not.toHaveBeenCalled();
});

test('empty discoveries preserve the configured list and do not retest it', async () => {
  const { result } = renderConnection('custom_0');
  await act(async () => result.current.handleModelsDiscovered('custom_0', []));
  expect(result.current.providers.custom_0.models).toEqual(initialModels);
  expect(mocks.batch).not.toHaveBeenCalled();
  expect(mocks.updateConfig).not.toHaveBeenCalled();
});

test('missing credentials or models block the probe without saving', async () => {
  const noKey = renderConnection(ProviderName.Moonshot, { apiKey: '' });
  await act(async () => noKey.result.current.handleTestConnection());
  noKey.unmount();
  const noModels = renderConnection(ProviderName.Moonshot, { models: [] });
  await act(async () => noModels.result.current.handleTestConnection());
  expect(mocks.single).not.toHaveBeenCalled();
  expect(mocks.updateConfig).not.toHaveBeenCalled();
});

test('a persistence failure does not enable the provider or announce success', async () => {
  const { result, callbacks } = renderConnection();
  mocks.updateConfig.mockRejectedValue(new Error('Mock save failure'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const dispatch = vi.spyOn(window, 'dispatchEvent');
  await act(async () => result.current.handleTestConnection());
  expect(callbacks.enable).not.toHaveBeenCalled();
  expect((dispatch.mock.calls.at(-1)?.[0] as CustomEvent | undefined)?.detail).toMatchObject({
    isError: true,
  });
});

test.each([0, 2])(
  'a batch with %s successes preserves the whole list and classified failures',
  async successCount => {
    mocks.batch.mockImplementation(async (input: BatchInput) =>
      input.models.map((model, index) => ({
        model,
        result:
          index < successCount
            ? { success: true }
            : {
                success: false,
                message: 'Mock server failure',
                failureKind: ProviderModelConnectionFailureKind.Server,
              },
      })),
    );
    const { result, saved, callbacks } = renderConnection(ProviderName.Moonshot, { enabled: true });
    await act(async () => result.current.handleModelsDiscovered(ProviderName.Moonshot, discovered));
    await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledOnce());
    expect(saved().models).toHaveLength(5);
    expect(
      saved()
        .models?.slice(0, successCount)
        .every(model => model.connectionTest?.status === ProviderModelConnectionTestStatus.Success),
    ).toBe(true);
    expect(
      saved()
        .models?.slice(successCount)
        .every(
          model => model.connectionTest?.failureKind === ProviderModelConnectionFailureKind.Server,
        ),
    ).toBe(true);
    expect(callbacks.enable).toHaveBeenCalledTimes(successCount > 0 ? 1 : 0);
  },
);

test('failed tests persist their classification without enabling a disabled provider', async () => {
  const failure: ProviderModelConnectionTestResult = {
    success: false,
    message: 'Mock auth failure',
    failureKind: ProviderModelConnectionFailureKind.Auth,
  };
  mocks.single.mockResolvedValue(failure);
  mocks.batch.mockImplementation(async (input: BatchInput) =>
    input.models.map(model => ({ model, result: failure })),
  );
  const { result, callbacks, saved } = renderConnection();
  await act(async () => result.current.handleTestConnection());
  await act(async () => result.current.handleModelsDiscovered(ProviderName.Moonshot, discovered));
  // Failure verdicts are merged into storage (they only hide models), but the
  // provider itself must not be enabled and no other stored field is touched.
  expect(
    saved().models?.every(
      model => model.connectionTest?.status === ProviderModelConnectionTestStatus.Failure,
    ),
  ).toBe(true);
  expect(saved().enabled).toBe(false);
  expect(callbacks.enable).not.toHaveBeenCalled();
  expect(result.current.providers.moonshot.enabled).toBe(false);
});

test('a fully failed discovery still saves the discovered models with their verdicts', async () => {
  const failure: ProviderModelConnectionTestResult = {
    success: false,
    message: 'Mock server failure',
    failureKind: ProviderModelConnectionFailureKind.Server,
  };
  mocks.batch.mockImplementation(async (input: BatchInput) =>
    input.models.map(model => ({ model, result: failure })),
  );
  const { result, saved, callbacks } = renderConnection(ProviderName.Moonshot, { models: [] });
  await act(async () => {
    await result.current.handleModelsDiscovered(ProviderName.Moonshot, discovered);
  });
  await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledOnce());
  expect(saved().models?.map(model => model.id)).toEqual(discovered.map(model => model.id));
  expect(
    saved().models?.every(
      model =>
        model.connectionTest?.status === ProviderModelConnectionTestStatus.Failure &&
        model.connectionTest.failureKind === ProviderModelConnectionFailureKind.Server,
    ),
  ).toBe(true);
  expect(callbacks.enable).not.toHaveBeenCalled();
});

test('a superseded single test cannot replace a newer successful result', async () => {
  const oldResponse = deferred<ProviderModelConnectionTestResult>();
  mocks.single.mockReturnValueOnce(oldResponse.promise);
  const { result, saved, callbacks } = renderConnection();
  let oldRequest: Promise<void>;
  await act(async () => {
    oldRequest = result.current.handleTestConnection('model-1');
  });
  await act(async () => result.current.handleTestConnection('model-2'));
  await act(async () => {
    oldResponse.resolve({
      success: false,
      message: 'Old failure',
      failureKind: ProviderModelConnectionFailureKind.Model,
    });
    await oldRequest;
  });
  expect(mocks.updateConfig).toHaveBeenCalledOnce();
  expect(callbacks.singleStatus).toHaveBeenCalledExactlyOnceWith(
    ProviderName.Moonshot,
    'model-2',
    ModelConnectionStatus.Success,
  );
  expect(saved().models?.[0].connectionTest).toBeUndefined();
  expect(saved().models?.[1].connectionTest?.status).toBe(
    ProviderModelConnectionTestStatus.Success,
  );
});

test('a row test uses its model ID and updates the current selection', async () => {
  const { result } = renderConnection();
  act(() => result.current.handleRowModelTest(initialModels[3]));
  await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledOnce());
  expect(result.current.selectedModelId).toBe('model-4');
  expect(mocks.single.mock.calls[0][0].model.id).toBe('model-4');
});

test('batch errors report failure without saving or enabling a provider', async () => {
  mocks.batch.mockRejectedValue(new Error('Mock batch failure'));
  const { result, callbacks } = renderConnection();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const dispatch = vi.spyOn(window, 'dispatchEvent');
  await act(async () => result.current.handleModelsDiscovered(ProviderName.Moonshot, discovered));
  await waitFor(() =>
    expect((dispatch.mock.calls.at(-1)?.[0] as CustomEvent | undefined)?.detail).toMatchObject({
      isError: true,
    }),
  );
  expect(mocks.updateConfig).not.toHaveBeenCalled();
  expect(callbacks.enable).not.toHaveBeenCalled();
});

test('batch persistence errors report failure without enabling a provider', async () => {
  const { result, callbacks } = renderConnection();
  mocks.updateConfig.mockRejectedValue(new Error('Mock save failure'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const dispatch = vi.spyOn(window, 'dispatchEvent');
  await act(async () => result.current.handleModelsDiscovered(ProviderName.Moonshot, discovered));
  await waitFor(() =>
    expect((dispatch.mock.calls.at(-1)?.[0] as CustomEvent | undefined)?.detail).toMatchObject({
      isError: true,
    }),
  );
  expect(callbacks.enable).not.toHaveBeenCalled();
});

test('a deleted model is not restored by its single test result', async () => {
  const response = deferred<ProviderModelConnectionTestResult>();
  mocks.single.mockReturnValue(response.promise);
  const { result, callbacks } = renderConnection();
  let pending: Promise<void>;
  await act(async () => {
    pending = result.current.handleTestConnection();
  });
  act(() =>
    result.current.setProviders(current => ({
      ...current,
      moonshot: { ...current.moonshot, models: current.moonshot.models!.slice(1) },
    })),
  );
  await act(async () => {
    response.resolve({ success: true });
    await pending;
  });
  expect(result.current.providers.moonshot.models).toHaveLength(4);
  expect(mocks.updateConfig).not.toHaveBeenCalled();
  expect(callbacks.singleStatus).not.toHaveBeenCalled();
});

test('local connection tests target a running model without persisting or enabling the provider', async () => {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { llamacpp: { listRunningModels: vi.fn().mockResolvedValue([{ name: 'model-3' }]) } },
  });
  const { result, callbacks } = renderConnection(ProviderName.LlamaCpp, { apiKey: '' });
  await act(async () => result.current.handleTestConnection());
  expect(mocks.single.mock.calls[0][0].model.id).toBe('model-3');
  expect(mocks.updateConfig).not.toHaveBeenCalled();
  expect(callbacks.enable).not.toHaveBeenCalled();
});

test('local connection tests do not probe an unloaded configured model', async () => {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { llamacpp: { listRunningModels: vi.fn().mockResolvedValue([]) } },
  });
  const { result } = renderConnection(ProviderName.LlamaCpp, { apiKey: '' });
  await act(async () => result.current.handleTestConnection());
  expect(mocks.single).not.toHaveBeenCalled();
  expect(mocks.updateConfig).not.toHaveBeenCalled();
});
