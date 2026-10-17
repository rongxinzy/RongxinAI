// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { CodingSidePanelView } from './constants';
import { useCodingSidePanelController } from './useCodingSidePanelController';

let reduceMotion = false;

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  reduceMotion = false;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    void callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' && reduceMotion,
  }));
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderController = (resetKey: string | null = null, clientWidth = 1200) => {
  const containerRef = { current: { clientWidth } as HTMLDivElement };
  return renderHook(
    ({ key }: { key: string | null }) =>
      useCodingSidePanelController({
        containerRef,
        isNarrowViewport: false,
        resetKey: key,
      }),
    { initialProps: { key: resetKey } },
  );
};

test('opens tabs, tracks the active view and returns to the launcher when the last tab closes', () => {
  const view = renderController();

  act(() => view.result.current.openSidePanelTab(CodingSidePanelView.Review));
  expect(view.result.current.sidePanelView).toBe(CodingSidePanelView.Review);
  expect(view.result.current.visibleSidePanelTabs).toEqual([CodingSidePanelView.Review]);
  expect(view.result.current.isSidePanelPresent).toBe(true);

  act(() => view.result.current.openSidePanelTab(CodingSidePanelView.Files));
  expect(view.result.current.visibleSidePanelTabs).toEqual([
    CodingSidePanelView.Review,
    CodingSidePanelView.Files,
  ]);
  expect(view.result.current.sidePanelView).toBe(CodingSidePanelView.Files);

  // Re-opening an open tab only activates it; the tab is not duplicated.
  act(() => view.result.current.openSidePanelTab(CodingSidePanelView.Review));
  expect(view.result.current.visibleSidePanelTabs).toEqual([
    CodingSidePanelView.Review,
    CodingSidePanelView.Files,
  ]);
  expect(view.result.current.sidePanelView).toBe(CodingSidePanelView.Review);

  // Closing an inactive tab keeps the active view.
  act(() => view.result.current.closeSidePanelTab(CodingSidePanelView.Files));
  expect(view.result.current.sidePanelView).toBe(CodingSidePanelView.Review);
  expect(view.result.current.visibleSidePanelTabs).toEqual([CodingSidePanelView.Review]);

  // Closing the last tab returns to the launcher and starts the close transition.
  act(() => view.result.current.closeSidePanelTab(CodingSidePanelView.Review));
  expect(view.result.current.sidePanelView).toBe(CodingSidePanelView.Launcher);
  expect(view.result.current.visibleSidePanelTabs).toEqual([]);
  expect(view.result.current.isSidePanelClosing).toBe(true);

  // The panel stays mounted until the close transition completes.
  expect(view.result.current.isSidePanelPresent).toBe(true);
  act(() => view.result.current.completeSidePanelClose());
  expect(view.result.current.isSidePanelPresent).toBe(false);
  expect(view.result.current.sidePanelHidden).toBe(true);
});

test('opening the launcher clears the open tabs', () => {
  const view = renderController();

  act(() => view.result.current.openSidePanelTab(CodingSidePanelView.Files));
  act(() => view.result.current.openSidePanelTab(CodingSidePanelView.Review));
  act(() => view.result.current.openSidePanelTab(CodingSidePanelView.Launcher));

  expect(view.result.current.sidePanelView).toBe(CodingSidePanelView.Launcher);
  expect(view.result.current.visibleSidePanelTabs).toEqual([]);
});

test('restore falls back to the launcher when no view is open', () => {
  const view = renderController();

  act(() => view.result.current.restoreSidePanel());

  expect(view.result.current.sidePanelView).toBe(CodingSidePanelView.Launcher);
  expect(view.result.current.sidePanelHidden).toBe(false);
  expect(view.result.current.isSidePanelPresent).toBe(true);
});

test('hiding marks the panel hidden once the close transition completes', () => {
  const view = renderController();
  act(() => view.result.current.openSidePanelTab(CodingSidePanelView.Review));

  act(() => view.result.current.requestHideSidePanel());
  expect(view.result.current.isSidePanelClosing).toBe(true);

  act(() => view.result.current.completeSidePanelClose());
  expect(view.result.current.sidePanelHidden).toBe(true);
  expect(view.result.current.sidePanelExpanded).toBe(false);
});

test('clamps drag widths between the min and max panel width', () => {
  // Container of 1200px: max = min(1200 - 360, 1200 * 0.6) = 720.
  const view = renderController(null, 1200);

  act(() => view.result.current.applySidePanelFrameWidth(5000));
  expect(view.result.current.renderedSidePanelWidth).toBe(720);

  act(() => view.result.current.applySidePanelFrameWidth(10));
  expect(view.result.current.renderedSidePanelWidth).toBe(280);

  act(() => view.result.current.completeSidePanelResize(400));
  // The transient width no longer overrides the resolved width.
  expect(view.result.current.renderedSidePanelWidth).toBe(
    view.result.current.resolvedSidePanelWidth,
  );
  expect(view.result.current.resolvedSidePanelWidth).toBe(400);
});

test('resets tabs, view and sheet when the reset key changes', () => {
  const view = renderController('lane-1');

  act(() => view.result.current.openSidePanelTab(CodingSidePanelView.Files));
  act(() => view.result.current.setSidePanelSheetOpen(true));
  act(() => view.result.current.setSidePanelExpanded(true));

  act(() => view.rerender({ key: 'lane-2' }));

  expect(view.result.current.sidePanelView).toBe(null);
  expect(view.result.current.visibleSidePanelTabs).toEqual([]);
  expect(view.result.current.sidePanelSheetOpen).toBe(false);
  // The expanded toggle persists across lane switches, like the original.
  expect(view.result.current.sidePanelExpanded).toBe(true);
});
