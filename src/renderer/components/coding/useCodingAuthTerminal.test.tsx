// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { useCodingAuthTerminal } from './useCodingAuthTerminal';

interface AuthTerminalDataEvent {
  id: string;
  data: string;
}

interface AuthTerminalExitEvent {
  id: string;
  exitCode: number;
}

const captureToasts = () => {
  const seen: string[] = [];
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ message: string } | string>).detail;
    seen.push(typeof detail === 'string' ? detail : detail.message);
  };
  window.addEventListener('app:showToast', listener);
  return { seen, stop: () => window.removeEventListener('app:showToast', listener) };
};

const originalElectron = Object.getOwnPropertyDescriptor(window, 'electron');
afterEach(() => {
  if (originalElectron) Object.defineProperty(window, 'electron', originalElectron);
  else Reflect.deleteProperty(window, 'electron');
});

function setup() {
  const dataListeners: ((event: AuthTerminalDataEvent) => void)[] = [];
  const exitListeners: ((event: AuthTerminalExitEvent) => void)[] = [];
  const writeAuthTerminal = vi.fn(async () => ({ success: true }));
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      codingAgent: {
        onAuthTerminalData: (callback: (event: AuthTerminalDataEvent) => void) => {
          dataListeners.push(callback);
          return () => undefined;
        },
        onAuthTerminalExit: (callback: (event: AuthTerminalExitEvent) => void) => {
          exitListeners.push(callback);
          return () => undefined;
        },
        writeAuthTerminal,
      },
    },
  });
  const view = renderHook(() => useCodingAuthTerminal());
  return { dataListeners, exitListeners, view, writeAuthTerminal };
}

test('subscribes to auth terminal streams on mount', () => {
  const { dataListeners, exitListeners } = setup();
  expect(dataListeners).toHaveLength(1);
  expect(exitListeners).toHaveLength(1);
});

test('ignores data and exit events for terminals it does not track', () => {
  const { dataListeners, exitListeners, view } = setup();

  act(() => dataListeners[0]({ id: 'term-1', data: 'hello' }));
  expect(view.result.current.authTerminal).toBe(null);

  act(() => exitListeners[0]({ id: 'term-1', exitCode: 0 }));
  expect(view.result.current.authTerminal).toBe(null);
});

test('shows a toast when a terminal exits with a non-zero code', () => {
  const toasts = captureToasts();
  const { exitListeners } = setup();

  act(() => exitListeners[0]({ id: 'term-unknown', exitCode: 1 }));

  expect(toasts.seen).toHaveLength(1);
  toasts.stop();
});

test('does not write input while no terminal is tracked', () => {
  const { view, writeAuthTerminal } = setup();

  act(() => view.result.current.setAuthTerminalInput('user input'));
  act(() => view.result.current.submitAuthTerminalInput());

  expect(writeAuthTerminal).not.toHaveBeenCalled();
  // The input is only cleared after a successful write.
  expect(view.result.current.authTerminalInput).toBe('user input');
});
