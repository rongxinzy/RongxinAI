// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  clearResolvedLocalPathCache,
  isLocalPathCandidate,
  useResolvedLocalPath,
} from './useResolvedLocalPath';

type ResolveLocalPathMock = ReturnType<typeof vi.fn>;

const installElectronMock = (resolveLocalPath: ResolveLocalPathMock): void => {
  (window as { electron?: unknown }).electron = {
    shell: { resolveLocalPath },
  };
};

afterEach(() => {
  delete (window as { electron?: unknown }).electron;
  clearResolvedLocalPathCache();
  vi.restoreAllMocks();
});

describe('isLocalPathCandidate', () => {
  test('accepts single-line path-looking strings', () => {
    expect(isLocalPathCandidate('C:/Users/a/report.html')).toBe(true);
    expect(isLocalPathCandidate('file:///tmp/a.txt')).toBe(true);
    expect(isLocalPathCandidate('./docs/a.md')).toBe(true);
    expect(isLocalPathCandidate('notes/today.md')).toBe(true);
  });

  test('rejects plain words, multi-line and oversized strings', () => {
    expect(isLocalPathCandidate('hello')).toBe(false);
    expect(isLocalPathCandidate('')).toBe(false);
    expect(isLocalPathCandidate('a\nb.txt')).toBe(false);
    expect(isLocalPathCandidate(`${'a'.repeat(300)}.txt`)).toBe(false);
    expect(isLocalPathCandidate('  spaced.txt  ')).toBe(true); // trimmed content still path-looking
    expect(isLocalPathCandidate('   ')).toBe(false);
  });
});

describe('useResolvedLocalPath', () => {
  test('resolves through shell.resolveLocalPath with cwd and caches per cwd+candidate', async () => {
    const resolveLocalPath = vi.fn(async (candidate: string, cwd?: string) => ({
      path: cwd ? `${cwd}/${candidate}` : candidate,
    }));
    installElectronMock(resolveLocalPath);

    const first = renderHook(() => useResolvedLocalPath('report.html', '/work/proj', true));
    await waitFor(() => expect(first.result.current).toBe('/work/proj/report.html'));
    expect(resolveLocalPath).toHaveBeenCalledTimes(1);
    expect(resolveLocalPath).toHaveBeenCalledWith('report.html', '/work/proj');

    // Same candidate + cwd comes from cache; no extra IPC.
    const second = renderHook(() => useResolvedLocalPath('report.html', '/work/proj', true));
    expect(second.result.current).toBe('/work/proj/report.html');
    expect(resolveLocalPath).toHaveBeenCalledTimes(1);

    // Different cwd is a different cache key.
    const third = renderHook(() => useResolvedLocalPath('report.html', '/other', true));
    await waitFor(() => expect(third.result.current).toBe('/other/report.html'));
    expect(resolveLocalPath).toHaveBeenCalledTimes(2);
  });

  test('stays null when main reports no match and disables IPC while streaming', async () => {
    const resolveLocalPath = vi.fn(async () => ({ path: null }));
    installElectronMock(resolveLocalPath);

    const miss = renderHook(() => useResolvedLocalPath('missing.txt', '/work', true));
    await waitFor(() => expect(miss.result.current).toBeNull());
    expect(resolveLocalPath).toHaveBeenCalledTimes(1);

    // enabled=false (committed block while streaming) must not hit the IPC.
    const disabled = renderHook(() => useResolvedLocalPath('report.html', '/work', false));
    expect(disabled.result.current).toBeNull();
    expect(resolveLocalPath).toHaveBeenCalledTimes(1);
  });

  test('treats a rejected IPC as unresolved', async () => {
    const resolveLocalPath = vi.fn(async () => {
      throw new Error('ipc failure');
    });
    installElectronMock(resolveLocalPath);

    const failed = renderHook(() => useResolvedLocalPath('report.html', '/work', true));
    await waitFor(() => expect(failed.result.current).toBeNull());
  });

  test('updates when the same hook instance re-enables after streaming', async () => {
    const resolveLocalPath = vi.fn(async (candidate: string) => ({
      path: `/resolved/${candidate}`,
    }));
    installElectronMock(resolveLocalPath);

    const hook = renderHook(
      ({ enabled }) => useResolvedLocalPath('report.html', '/work', enabled),
      {
        initialProps: { enabled: false },
      },
    );
    expect(hook.result.current).toBeNull();
    expect(resolveLocalPath).not.toHaveBeenCalled();

    act(() => hook.rerender({ enabled: true }));
    await waitFor(() => expect(hook.result.current).toBe('/resolved/report.html'));
  });
});
