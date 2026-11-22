// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { MainView } from './constants';
import { useCompanionNavigation } from './companionNavigation';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('workbench navigation follows the native event and unsubscribes on unmount', () => {
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
  native?.();
  expect(view).toHaveBeenCalledExactlyOnceWith(MainView.Cowork);
  hook.unmount();
  expect(off).toHaveBeenCalledOnce();
  expect(native).toBeUndefined();
});
