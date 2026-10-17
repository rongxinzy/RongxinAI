/**
 * Optional --render harness for group D: a jsdom document plus the smallest
 * honest renderer — a component that subscribes to the real LiveTextStore via
 * useSyncExternalStore and renders <pre>{text}</pre> — wrapped in React.Profiler.
 *
 * This is a LOWER BOUND for the real renderer: StreamingMarkdownResponse
 * (streamdown + CSS) and Playwright frame tracking are deliberately out of
 * scope for this bench (review S1).
 *
 * Mount happens on real timers before the scenario installs the virtual
 * clock. Per-frame flushes use ReactDOM.flushSync because the virtual clock
 * never yields to React's real MessageChannel scheduler; queueMicrotask is
 * patched to run inline during the scenario, so store notifications reach
 * React inside the measured frame callback.
 */
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  createElement,
  Profiler,
  useSyncExternalStore,
  type ProfilerOnRenderCallback,
  type ReactElement,
} from 'react';

import type { LiveTextStore } from '../../src/renderer/services/liveTextStore';
import { percentileOf, roundTo, type RenderMetrics } from './scenarioShared';

export interface RenderHarness {
  /** Flush pending React store updates synchronously (call inside the frame callback). */
  flush(): void;
  collect(): RenderMetrics;
  dispose(): void;
}

const setDomGlobal = (
  key: 'window' | 'document' | 'navigator',
  value: unknown,
): PropertyDescriptor | undefined => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  return saved;
};

const restoreDomGlobal = (key: string, saved: PropertyDescriptor | undefined): void => {
  const holder = globalThis as unknown as Record<string, unknown>;
  if (saved === undefined) {
    delete holder[key];
    return;
  }
  Object.defineProperty(globalThis, key, saved);
};

export const createRenderHarness = async (
  store: LiveTextStore,
  messageId: string,
): Promise<RenderHarness> => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="bench-root"></div></body></html>');
  const container = dom.window.document.getElementById('bench-root');
  if (container === null) throw new Error('bench: #bench-root missing from the jsdom document');

  const savedWindow = setDomGlobal('window', dom.window);
  const savedDocument = setDomGlobal('document', dom.window.document);
  const savedNavigator = setDomGlobal('navigator', dom.window.navigator);

  try {
    let componentRenders = 0;
    const subscribe = (onStoreChange: () => void): (() => void) => store.subscribe(onStoreChange);
    const getSnapshot = (): string | undefined => store.getSnapshot(messageId);

    const LiveTextPre = (): ReactElement => {
      componentRenders += 1;
      const text = useSyncExternalStore(subscribe, getSnapshot);
      return createElement('pre', null, text ?? '');
    };

    const durations: number[] = [];
    let profilerCommits = 0;
    const onRender: ProfilerOnRenderCallback = (id, phase, actualDuration) => {
      void id;
      void phase;
      profilerCommits += 1;
      durations.push(actualDuration);
    };

    const root = createRoot(container);
    const tree = createElement(
      Profiler,
      { id: 'bench-stream', onRender },
      createElement(LiveTextPre),
    );
    flushSync(() => {
      root.render(tree);
    });
    // The concurrent scheduler may still hold the mount; yield once to the
    // real event loop before the scenario replaces the globals.
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
    if (componentRenders === 0) {
      throw new Error('bench: React mount never committed; cannot run the --render harness');
    }

    let disposed = false;
    return {
      flush: (): void => {
        flushSync(() => {});
      },
      collect: (): RenderMetrics => {
        const sum = durations.reduce((total, value) => total + value, 0);
        return {
          commits: profilerCommits > 0 ? profilerCommits : componentRenders,
          profilerAvailable: profilerCommits > 0,
          profilerDurationSumMs: roundTo(sum),
          profilerDurationP95Ms: roundTo(percentileOf(durations, 95)),
        };
      },
      dispose: (): void => {
        if (disposed) return;
        disposed = true;
        try {
          root.unmount();
        } finally {
          restoreDomGlobal('window', savedWindow);
          restoreDomGlobal('document', savedDocument);
          restoreDomGlobal('navigator', savedNavigator);
        }
      },
    };
  } catch (error) {
    restoreDomGlobal('window', savedWindow);
    restoreDomGlobal('document', savedDocument);
    restoreDomGlobal('navigator', savedNavigator);
    throw error;
  }
};
