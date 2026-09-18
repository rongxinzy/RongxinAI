// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ApiFormat } from '@shared/providers';

import { i18nService } from '../../services/i18n';
import { resolveToastNotification, type ToastNotificationDetail } from '../../services/toastNotification';
import { ProviderModelDiscoveryButton } from './ProviderModelDiscoveryButton';

type ModelsDiscoveredHandler = (providerId: string, models: readonly unknown[]) => void;

const providerConfig = {
  enabled: true,
  apiKey: 'sk-test',
  baseUrl: 'https://api.moonshot.cn/v1',
  apiFormat: ApiFormat.OpenAI,
} as unknown as Parameters<typeof ProviderModelDiscoveryButton>[0]['provider'];

/** 收集组件派发的 app:showToast，断言用户最终看到的那条提示。 */
const captureToasts = () => {
  const details: ToastNotificationDetail[] = [];
  const listener = (event: Event) => {
    details.push((event as CustomEvent<ToastNotificationDetail>).detail);
  };
  window.addEventListener('app:showToast', listener);
  return {
    details,
    stop: () => window.removeEventListener('app:showToast', listener),
    last: () => resolveToastNotification(details.at(-1)),
  };
};

const stubFetchModels = (result: unknown) => {
  window.electron = {
    api: { fetchModels: vi.fn().mockResolvedValue(result) },
  } as unknown as typeof window.electron;
};

const renderButton = (onModelsDiscovered: ModelsDiscoveredHandler) =>
  render(
    <ProviderModelDiscoveryButton
      providerId="moonshot"
      provider={providerConfig}
      baseUrl="https://api.moonshot.cn/v1"
      apiFormat={ApiFormat.OpenAI}
      requiresApiKey
      prominent
      onModelsDiscovered={onModelsDiscovered}
    />,
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('reports an empty discovery result instead of staying silent', async () => {
  stubFetchModels({ success: true, models: [] });
  // 提供商已经配置过模型时，旧实现会因为「顺手重测了已有模型」而吞掉空结果提示，
  // 所以这里刻意让回调返回 true，锁定空结果必须照样提示。
  const onModelsDiscovered = vi.fn().mockReturnValue(true);
  const toasts = captureToasts();
  renderButton(onModelsDiscovered as unknown as ModelsDiscoveredHandler);

  fireEvent.click(screen.getByRole('button'));

  await waitFor(() => expect(onModelsDiscovered).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(toasts.last()).toEqual({
      message: i18nService.t('fetchModelsEmpty'),
      options: { isError: false, isSuccess: false },
    }),
  );
  toasts.stop();
});

test('does not report an empty result when models were discovered', async () => {
  stubFetchModels({ success: true, models: [{ id: 'kimi-k2.5' }] });
  const onModelsDiscovered = vi.fn();
  const toasts = captureToasts();
  renderButton(onModelsDiscovered);

  fireEvent.click(screen.getByRole('button'));

  await waitFor(() => expect(onModelsDiscovered).toHaveBeenCalledTimes(1));
  expect(onModelsDiscovered.mock.calls[0][1]).toEqual([{ id: 'kimi-k2.5' }]);
  expect(toasts.details).toEqual([]);
  toasts.stop();
});

test('reports a failed discovery as a neutral notice the user can actually see', async () => {
  stubFetchModels({ success: false, code: 'network' });
  const onModelsDiscovered = vi.fn();
  const toasts = captureToasts();
  renderButton(onModelsDiscovered);

  fireEvent.click(screen.getByRole('button'));

  await waitFor(() => expect(toasts.details).toHaveLength(1));
  const resolved = toasts.last();
  expect(resolved?.message).toBe(i18nService.t('fetchModelsFailed'));
  // 只读探测失败不改动任何状态，正文里带「无法」也不该被启发式升级成红色错误。
  expect(resolved?.options).toMatchObject({ isError: false, isSuccess: false });
  expect(onModelsDiscovered).not.toHaveBeenCalled();
  toasts.stop();
});

test('reports an unreachable endpoint with the endpoint reason', async () => {
  stubFetchModels({ success: false, code: 'endpoint_not_found' });
  const toasts = captureToasts();
  renderButton(vi.fn());

  fireEvent.click(screen.getByRole('button'));

  await waitFor(() => expect(toasts.details).toHaveLength(1));
  const resolved = toasts.last();
  expect(resolved?.message).toBe(i18nService.t('fetchModelsEndpointNotFound'));
  expect(resolved?.options).toMatchObject({ isError: false, isSuccess: false });
  toasts.stop();
});

test('asks for the missing endpoint without error styling', async () => {
  stubFetchModels({ success: true, models: [] });
  const toasts = captureToasts();
  render(
    <ProviderModelDiscoveryButton
      providerId="moonshot"
      provider={{ ...providerConfig, baseUrl: '' } as typeof providerConfig}
      baseUrl=""
      apiFormat={ApiFormat.OpenAI}
      requiresApiKey
      prominent
      onModelsDiscovered={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole('button'));

  await waitFor(() => expect(toasts.details).toHaveLength(1));
  expect(toasts.last()).toEqual({
    message: i18nService.t('fetchModelsNeedEndpoint'),
    options: { isError: false, isSuccess: false },
  });
  toasts.stop();
});
