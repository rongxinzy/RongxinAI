// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { AppUpdateStatus, type AppUpdateRuntimeState } from '../../shared/appUpdate/constants';
import { useAppUpdateState } from './useAppUpdateState';

const idleState: AppUpdateRuntimeState = {
  status: AppUpdateStatus.Idle,
  source: null,
  info: null,
  progress: null,
  readyFilePath: null,
  readyFileHash: null,
  errorMessage: null,
  lastCheckedAt: null,
  failureStage: null,
  lastInstallResult: null,
};

const getState = vi.fn<() => Promise<AppUpdateRuntimeState>>();
const unsubscribe = vi.fn();
let push: ((state: AppUpdateRuntimeState) => void) | null = null;
const onStateChanged = vi.fn((listener: (state: AppUpdateRuntimeState) => void) => {
  push = listener;
  return unsubscribe;
});

beforeEach(() => {
  vi.clearAllMocks();
  push = null;
  getState.mockResolvedValue(idleState);
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { appUpdate: { getState, onStateChanged } },
  });
});

describe('useAppUpdateState', () => {
  test('mirrors the main process state through one shared subscription', async () => {
    const first = renderHook(() => useAppUpdateState());
    const second = renderHook(() => useAppUpdateState());

    await waitFor(() => expect(first.result.current.status).toBe(AppUpdateStatus.Idle));
    // Both components read one store: the IPC subscription and the initial
    // snapshot are created once, not once per consumer.
    expect(getState).toHaveBeenCalledTimes(1);
    expect(onStateChanged).toHaveBeenCalledTimes(1);

    push?.({ ...idleState, status: AppUpdateStatus.Verifying });
    await waitFor(() => expect(second.result.current.status).toBe(AppUpdateStatus.Verifying));

    first.unmount();
    expect(unsubscribe).not.toHaveBeenCalled();
    second.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
