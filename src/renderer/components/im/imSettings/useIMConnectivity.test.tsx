// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { expect, test, vi, beforeEach } from 'vitest';
import React from 'react';
import { Provider } from 'react-redux';

import { imService } from '../../../services/im';
import imReducer from '../../../store/slices/imSlice';
import { DEFAULT_IM_CONFIG } from '../../../types/im';
import { useIMConnectivity } from './useIMConnectivity';

vi.mock('../../../services/im', () => ({
  imService: {
    syncPendingConfig: vi.fn(),
    testGateway: vi.fn(),
    persistConfig: vi.fn(),
    updateDingTalkInstanceConfig: vi.fn(),
  },
}));

const mockImService = vi.mocked(imService, true);

const NO_ACTIVE_INSTANCE = {
  dingtalk: null,
  feishu: null,
  qq: null,
  wecom: null,
};

const authPassResult = {
  platform: 'dingtalk' as const,
  testedAt: 1_700_000_000_000,
  verdict: 'pass' as const,
  checks: [{ code: 'auth_check' as const, level: 'pass' as const, message: 'ok' }],
};

function renderConnectivityHook(overrides: Partial<Parameters<typeof useIMConnectivity>[0]> = {}) {
  const store = configureStore({
    reducer: { im: imReducer },
  });
  const dispatchSpy = vi.spyOn(store, 'dispatch');
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(
    () =>
      useIMConnectivity({
        config: DEFAULT_IM_CONFIG,
        configLoaded: false,
        activeInstanceIds: { ...NO_ACTIVE_INSTANCE },
        isPlatformEnabled: () => false,
        toggleGateway: vi.fn(),
        ...overrides,
      }),
    { wrapper },
  );
  return { ...hook, dispatchSpy };
}

beforeEach(() => {
  mockImService.syncPendingConfig.mockReset().mockResolvedValue(true);
  mockImService.testGateway.mockReset().mockResolvedValue(null);
  mockImService.persistConfig.mockReset().mockResolvedValue(true);
  mockImService.updateDingTalkInstanceConfig.mockReset().mockResolvedValue(true);
});

test('runConnectivityTest stores a successful result and clears stale entries', async () => {
  mockImService.testGateway.mockResolvedValue(authPassResult);
  const { result } = renderConnectivityHook();

  await act(async () => {
    const returned = await result.current.runConnectivityTest('dingtalk');
    expect(returned).toEqual(authPassResult);
  });

  expect(result.current.connectivityResults.dingtalk).toEqual(authPassResult);
  expect(result.current.connectivityFailures.dingtalk).toBeUndefined();
});

test('runConnectivityTest records a failure when the gateway test returns nothing', async () => {
  mockImService.testGateway.mockResolvedValue(null);
  const { result } = renderConnectivityHook();

  await act(async () => {
    const returned = await result.current.runConnectivityTest('dingtalk');
    expect(returned).toBeNull();
  });

  expect(result.current.connectivityResults.dingtalk).toBeUndefined();
  expect(result.current.connectivityFailures.dingtalk).toBe(true);
});

test('runConnectivityTest records a failure when pending config cannot sync', async () => {
  mockImService.syncPendingConfig.mockResolvedValue(false);
  const { result } = renderConnectivityHook();

  await act(async () => {
    await result.current.runConnectivityTest('dingtalk');
  });

  expect(mockImService.testGateway).not.toHaveBeenCalled();
  expect(result.current.connectivityFailures.dingtalk).toBe(true);
});

test('handleConnectivityTest auto-enables a disabled dingtalk instance after a passed auth check', async () => {
  mockImService.testGateway.mockResolvedValue(authPassResult);
  const config = {
    ...DEFAULT_IM_CONFIG,
    dingtalk: {
      instances: [{ instanceId: 'd1', enabled: false, clientId: 'id', clientSecret: 'sec' }],
    },
  };
  const { result, dispatchSpy } = renderConnectivityHook({
    config: config as typeof DEFAULT_IM_CONFIG,
    activeInstanceIds: { ...NO_ACTIVE_INSTANCE, dingtalk: 'd1' },
  });

  await act(async () => {
    await result.current.handleConnectivityTest('dingtalk');
  });

  expect(mockImService.persistConfig).toHaveBeenCalledWith({ dingtalk: config.dingtalk });
  expect(mockImService.testGateway).toHaveBeenCalledWith(
    'dingtalk',
    { dingtalk: config.dingtalk },
    'd1',
  );
  expect(mockImService.updateDingTalkInstanceConfig).toHaveBeenCalledWith('d1', { enabled: true });
  expect(dispatchSpy).toHaveBeenCalledWith({
    type: 'im/setDingTalkInstanceConfig',
    payload: { instanceId: 'd1', config: { enabled: true } },
  });
  // Testing state is reset once the handler finishes.
  expect(result.current.testingPlatform).toBeNull();
  expect(result.current.connectivityModalPlatform).toBe('dingtalk');
});

test('handleConnectivityTest does not auto-enable an already enabled instance', async () => {
  mockImService.testGateway.mockResolvedValue(authPassResult);
  const config = {
    ...DEFAULT_IM_CONFIG,
    dingtalk: {
      instances: [{ instanceId: 'd1', enabled: true, clientId: 'id', clientSecret: 'sec' }],
    },
  };
  const { result, dispatchSpy } = renderConnectivityHook({
    config: config as typeof DEFAULT_IM_CONFIG,
    activeInstanceIds: { ...NO_ACTIVE_INSTANCE, dingtalk: 'd1' },
  });

  await act(async () => {
    await result.current.handleConnectivityTest('dingtalk');
  });

  expect(mockImService.updateDingTalkInstanceConfig).not.toHaveBeenCalled();
  expect(dispatchSpy).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'im/setDingTalkInstanceConfig' }),
  );
  expect(result.current.connectivityResults.dingtalk).toEqual(authPassResult);
});

test('handleConnectivityTest skips auto-enable when auth check does not pass', async () => {
  mockImService.testGateway.mockResolvedValue({
    ...authPassResult,
    verdict: 'fail',
    checks: [{ code: 'auth_check', level: 'fail', message: 'bad token' }],
  });
  const config = {
    ...DEFAULT_IM_CONFIG,
    dingtalk: {
      instances: [{ instanceId: 'd1', enabled: false, clientId: 'id', clientSecret: 'sec' }],
    },
  };
  const { result } = renderConnectivityHook({
    config: config as typeof DEFAULT_IM_CONFIG,
    activeInstanceIds: { ...NO_ACTIVE_INSTANCE, dingtalk: 'd1' },
  });

  await act(async () => {
    await result.current.handleConnectivityTest('dingtalk');
  });

  expect(mockImService.updateDingTalkInstanceConfig).not.toHaveBeenCalled();
  expect(result.current.connectivityResults.dingtalk?.verdict).toBe('fail');
});

test('handleConnectivityTest toggles weixin on after a passed auth check while disabled', async () => {
  mockImService.testGateway.mockResolvedValue({ ...authPassResult, platform: 'weixin' });
  const toggleGateway = vi.fn();
  const { result } = renderConnectivityHook({ toggleGateway });

  await act(async () => {
    await result.current.handleConnectivityTest('weixin');
  });

  expect(toggleGateway).toHaveBeenCalledWith('weixin');
  expect(result.current.connectivityModalPlatform).toBe('weixin');
});

test('handleConnectivityTest keeps weixin off when the auth check fails', async () => {
  mockImService.testGateway.mockResolvedValue({
    ...authPassResult,
    platform: 'weixin',
    checks: [{ code: 'auth_check', level: 'fail', message: 'not logged in' }],
  });
  const toggleGateway = vi.fn();
  const { result } = renderConnectivityHook({ toggleGateway });

  await act(async () => {
    await result.current.handleConnectivityTest('weixin');
  });

  expect(toggleGateway).not.toHaveBeenCalled();
});
