// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { MainView } from './constants';
import { requestCompanionNavigation, useCompanionNavigation } from './companionNavigation';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('workbench navigation follows the native event and releases both subscriptions on unmount', () => {
  let native: (() => void) | undefined;
  const off = vi.fn(() => {
    native = undefined;
  });
  vi.stubGlobal('electron', {
    companion: {
      onWorkbench: (listener: () => void) => {
        native = listener;
        return off;
      },
    },
  });
  const view = vi.fn();
  const hook = renderHook(() => useCompanionNavigation(view));
  requestCompanionNavigation(MainView.Cowork);
  expect(view).toHaveBeenCalledExactlyOnceWith(MainView.Cowork);
  view.mockClear();
  window.dispatchEvent(new CustomEvent('app:companion-navigation', { detail: MainView.Settings }));
  expect(view).not.toHaveBeenCalled();
  native?.();
  expect(view).toHaveBeenCalledExactlyOnceWith(MainView.Cowork);
  hook.unmount();
  expect(off).toHaveBeenCalledOnce();
  expect(native).toBeUndefined();
  view.mockClear();
  requestCompanionNavigation(MainView.Cowork);
  expect(view).not.toHaveBeenCalled();
});
