// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { MainView } from './constants';
import { useLocalInferenceVisibility } from './useLocalInferenceVisibility';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test('retains a visited inference view for quick returns, sleeps after ten minutes, and wakes on return', () => {
  vi.useFakeTimers();
  const hook = renderHook(({ view }) => useLocalInferenceVisibility(view), {
    initialProps: { view: MainView.Cowork as MainView },
  });
  act(() => vi.advanceTimersByTime(600_000));
  expect(hook.result.current).toEqual({
    hasMountedLocalInference: false,
    isLocalInferenceDormant: false,
  });
  hook.rerender({ view: MainView.LocalInference });
  hook.rerender({ view: MainView.Cowork });
  act(() => vi.advanceTimersByTime(599_999));
  expect(hook.result.current.isLocalInferenceDormant).toBe(false);
  hook.rerender({ view: MainView.LocalInference });
  act(() => vi.advanceTimersByTime(600_000));
  expect(hook.result.current.isLocalInferenceDormant).toBe(false);
  hook.rerender({ view: MainView.Cowork });
  act(() => vi.advanceTimersByTime(600_000));
  expect(hook.result.current).toEqual({
    hasMountedLocalInference: true,
    isLocalInferenceDormant: true,
  });
  hook.rerender({ view: MainView.LocalInference });
  expect(hook.result.current.isLocalInferenceDormant).toBe(false);
});
