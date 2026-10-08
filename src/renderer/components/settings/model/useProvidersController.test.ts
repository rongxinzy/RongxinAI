// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { ApiFormat, ProviderName, ProviderRegistry } from '../../../../shared/providers';
import { defaultConfig, type AppConfig } from '../../../config';
import type { ProviderConfig, ProviderType } from './constants';
import { useProvidersController } from './useProvidersController';

const mocks = vi.hoisted(() => ({ reload: vi.fn(), getConfig: vi.fn(), updateConfig: vi.fn() }));
vi.mock('../../../services/config', () => ({ configService: mocks }));
vi.mock('../../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));

async function renderController(
  provider: ProviderType = ProviderName.Moonshot,
  patch: Partial<ProviderConfig> = {},
) {
  const config: AppConfig = {
    ...defaultConfig,
    providers: {
      ...defaultConfig.providers,
      [provider]: {
        ...defaultConfig.providers![ProviderName.Moonshot],
        enabled: true,
        apiKey: 'mock-key',
        baseUrl: 'https://mock-provider.invalid/v1',
        apiFormat: ApiFormat.OpenAI,
        models: Array.from({ length: 5 }, (_, index) => ({
          id: `model-${index + 1}`,
          name: `Model ${index + 1}`,
        })),
        ...patch,
      },
    },
  };
  mocks.reload.mockResolvedValue(config);
  mocks.getConfig.mockReturnValue(config);
  mocks.updateConfig.mockResolvedValue(undefined);
  const invalidate = vi.fn();
  const setError = vi.fn();
  const signIn = vi.fn();
  const hook = renderHook(() =>
    useProvidersController({
      initialProvider: provider,
      language: 'zh',
      setError,
      invalidateProviderModelConnectionStatuses: invalidate,
      requestCopilotSignInRef: { current: signIn },
    }),
  );
  await waitFor(() => expect(hook.result.current.isInitialProviderPending).toBe(false));
  return { ...hook, invalidate, setError, signIn };
}

beforeEach(() => vi.clearAllMocks());

test.each([
  ['apiKey', 'new-key'],
  ['baseUrl', 'https://new.invalid/v1'],
  ['apiFormat', ApiFormat.Anthropic],
  ['codingPlanEnabled', 'true'],
  ['authType', 'oauth'],
  ['oauthAccessToken', 'new-token'],
])('changing %s invalidates pending probes and displayed statuses', async (field, value) => {
  const { result, invalidate } = await renderController();
  act(() => result.current.handleProviderConfigChange(ProviderName.Moonshot, field, value));
  expect(invalidate).toHaveBeenCalledExactlyOnceWith(ProviderName.Moonshot);
});

test.each(
  ProviderRegistry.providerIds.filter(provider => ProviderRegistry.supportsCodingPlan(provider)),
)(
  '%s selects the coding plan catalog and restores the normal catalog on toggle',
  async providerId => {
    const provider = providerId as ProviderType;
    const definition = ProviderRegistry.get(provider)!;
    const { result, invalidate } = await renderController(provider);
    act(() => result.current.handleProviderConfigChange(provider, 'codingPlanEnabled', 'true'));
    expect(result.current.providers[provider].codingPlanEnabled).toBe(true);
    expect(result.current.providers[provider].models?.map(model => model.id)).toEqual(
      (definition.codingPlanModels ?? definition.defaultModels).map(model => model.id),
    );
    act(() => result.current.handleProviderConfigChange(provider, 'codingPlanEnabled', 'false'));
    expect(result.current.providers[provider].codingPlanEnabled).toBe(false);
    expect(result.current.providers[provider].models?.map(model => model.id)).toEqual(
      definition.defaultModels.map(model => model.id),
    );
    expect(invalidate).toHaveBeenCalledTimes(2);
  },
);

test('loading an authenticated preset preserves all five models', async () => {
  const { result } = await renderController();
  expect(result.current.providers.moonshot.models).toHaveLength(5);
  expect(result.current.activeProvider).toBe(ProviderName.Moonshot);
  expect(result.current.selectedModelId).toBe('model-1');
});

test('a display-name edit preserves selection and does not invalidate model tests', async () => {
  const { result, invalidate } = await renderController();
  act(() => result.current.setSelectedModelId('model-4'));
  act(() =>
    result.current.handleProviderConfigChange(
      ProviderName.Moonshot,
      'displayName',
      'Friendly name',
    ),
  );
  expect(result.current.selectedModelId).toBe('model-4');
  expect(result.current.providers.moonshot.models).toHaveLength(5);
  expect(invalidate).not.toHaveBeenCalled();
});

test('disabling a provider invalidates pending successful probes before they can re-enable it', async () => {
  const { result, invalidate } = await renderController();
  act(() => result.current.toggleProviderEnabled(ProviderName.Moonshot));
  expect(result.current.providers.moonshot.enabled).toBe(false);
  expect(invalidate).toHaveBeenCalledExactlyOnceWith(ProviderName.Moonshot);
});

test('deleting a custom provider invalidates pending probes and persists its removal', async () => {
  const { result, invalidate } = await renderController('custom_0');
  act(() => result.current.handleDeleteCustomProvider('custom_0'));
  act(() => result.current.confirmDeleteCustomProvider());
  expect(result.current.providers.custom_0).toBeUndefined();
  expect(mocks.updateConfig.mock.calls[0][0].providers.custom_0).toBeUndefined();
  expect(invalidate).toHaveBeenCalledExactlyOnceWith('custom_0');
});

test('clearing a key invalidates pending probes while retaining the configured model list', async () => {
  const { result, invalidate } = await renderController();
  act(() => result.current.requestApiKeyClear(ProviderName.Moonshot));
  act(() => result.current.confirmApiKeyClear());
  expect(result.current.providers.moonshot.apiKey).toBe('');
  expect(result.current.providers.moonshot.models).toHaveLength(5);
  expect(invalidate).toHaveBeenCalledExactlyOnceWith(ProviderName.Moonshot);
});

test('enabling a preset without a key is rejected before changing state', async () => {
  const { result, invalidate, setError } = await renderController(ProviderName.Moonshot, {
    enabled: false,
    apiKey: '',
  });
  act(() => result.current.toggleProviderEnabled(ProviderName.Moonshot));
  expect(result.current.providers.moonshot.enabled).toBe(false);
  expect(setError).toHaveBeenCalledWith('apiKeyRequired');
  expect(invalidate).not.toHaveBeenCalled();
});

test('API key edits schedule one discovery on blur, while a second blur is a no-op', async () => {
  const { result } = await renderController();
  act(() => result.current.handleApiKeyInputChange(ProviderName.Moonshot, 'edited-key'));
  act(() => result.current.handleApiKeyBlur(ProviderName.Moonshot));
  const request = result.current.autoDetectRequest;
  expect(request).toMatchObject({ provider: ProviderName.Moonshot });
  act(() => result.current.handleApiKeyBlur(ProviderName.Moonshot));
  expect(result.current.autoDetectRequest).toBe(request);
});
