// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { showAppToast } from '../services/appToast';
import { useAppToastDisplay } from './useAppToastDisplay';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test('replacement toasts cancel the old timeout and close once, with subscription removed on unmount', () => {
  vi.useFakeTimers();
  const close = vi.fn();
  const hook = renderHook(() => useAppToastDisplay());
  act(() => showAppToast('First', { durationMs: 100 }));
  act(() => vi.advanceTimersByTime(50));
  act(() => showAppToast('Second', { durationMs: 200, onClose: close }));
  act(() => vi.advanceTimersByTime(50));
  expect(hook.result.current?.props.message).toBe('Second');
  act(() => vi.advanceTimersByTime(150));
  expect(hook.result.current).toBeNull();
  expect(close).toHaveBeenCalledOnce();
  act(() => showAppToast('Persistent', { autoClose: false, onClose: close }));
  act(() => vi.advanceTimersByTime(60_000));
  expect(hook.result.current?.props.message).toBe('Persistent');
  hook.unmount();
  act(() => showAppToast('After unmount', { durationMs: 0, onClose: close }));
  act(() => vi.runAllTimers());
  expect(close).toHaveBeenCalledOnce();
});
