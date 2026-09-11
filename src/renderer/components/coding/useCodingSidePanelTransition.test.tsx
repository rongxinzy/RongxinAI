// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { useCodingSidePanelTransition } from './useCodingSidePanelTransition';

let entryFrame: FrameRequestCallback | null = null;
let reduceMotion = false;

beforeEach(() => {
  entryFrame = null;
  reduceMotion = false;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    entryFrame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' && reduceMotion,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('keeps the side panel mounted until its close transition completes', () => {
  const onCloseComplete = vi.fn();
  const view = renderHook(() =>
    useCodingSidePanelTransition({ isNarrowViewport: false, onCloseComplete }),
  );

  act(() => view.result.current.show());
  expect(view.result.current).toMatchObject({ isPresent: true, isEntering: true });

  act(() => entryFrame?.(0));
  expect(view.result.current.isEntering).toBe(false);

  act(() => view.result.current.hide());
  expect(view.result.current).toMatchObject({ isPresent: true, isClosing: true });
  expect(onCloseComplete).not.toHaveBeenCalled();

  act(() => view.result.current.completeClose());
  expect(view.result.current).toMatchObject({ isPresent: false, isClosing: false });
  expect(onCloseComplete).toHaveBeenCalledOnce();
});

test('closes immediately when reduced motion is enabled', () => {
  reduceMotion = true;
  const onCloseComplete = vi.fn();
  const view = renderHook(() =>
    useCodingSidePanelTransition({ isNarrowViewport: false, onCloseComplete }),
  );

  act(() => view.result.current.show());
  act(() => view.result.current.hide());

  expect(view.result.current).toMatchObject({ isPresent: false, isClosing: false });
  expect(onCloseComplete).toHaveBeenCalledOnce();
});

test('finishes closing when the browser does not dispatch transitionend', () => {
  vi.useFakeTimers();
  const onCloseComplete = vi.fn();
  const view = renderHook(() =>
    useCodingSidePanelTransition({ isNarrowViewport: false, onCloseComplete }),
  );

  act(() => view.result.current.show());
  act(() => entryFrame?.(0));
  act(() => view.result.current.hide());
  act(() => vi.advanceTimersByTime(240));

  expect(view.result.current).toMatchObject({ isPresent: false, isClosing: false });
  expect(onCloseComplete).toHaveBeenCalledOnce();
});
