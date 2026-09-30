// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { useIsEnterpriseBuild } from './useIsEnterpriseBuild';

const isEnterprise = vi.fn<() => Promise<boolean>>();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { appInfo: { isEnterprise } },
  });
});

describe('useIsEnterpriseBuild', () => {
  test('reports an enterprise build when the main process says so', async () => {
    isEnterprise.mockResolvedValue(true);

    const { result } = renderHook(() => useIsEnterpriseBuild());

    await waitFor(() => expect(result.current).toBe(true));
  });

  test('reports a community build when the main process says so', async () => {
    isEnterprise.mockResolvedValue(false);

    const { result } = renderHook(() => useIsEnterpriseBuild());

    await waitFor(() => expect(isEnterprise).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  test('reads as community when the bridge call fails', async () => {
    isEnterprise.mockRejectedValue(new Error('ipc unavailable'));

    const { result } = renderHook(() => useIsEnterpriseBuild());

    await waitFor(() => expect(isEnterprise).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  test('reads as community when the preload bridge is missing', () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { appInfo: {} },
    });

    const { result } = renderHook(() => useIsEnterpriseBuild());

    expect(result.current).toBe(false);
  });
});
