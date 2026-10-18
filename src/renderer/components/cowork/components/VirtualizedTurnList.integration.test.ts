// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ConversationViewportContext } from '@shared/components/ai-elements/useConversationViewport';

import type { ConversationTurn } from '../helpers/messageGrouping';
import { VirtualizedTurnList } from './VirtualizedTurnList';

const VIEWPORT_HEIGHT = 600;
const scrollRef = { current: null as HTMLElement | null };
const viewportTimeouts = new Set<number>();

const clearViewportTimeouts = (): void => {
  for (const timeout of viewportTimeouts) window.clearTimeout(timeout);
  viewportTimeouts.clear();
};

/**
 * Stand-in for the <Conversation> owner: provides a viewport whose scroll
 * element is the jsdom viewport, so the virtualizer is the single writer.
 * Follow state mirrors the real hook: upward user scrolls stop following.
 */
const followRef = { current: true };
const mockViewportValue = {
  attachContentElement: vi.fn(),
  attachScrollElement: (element: HTMLDivElement | null) => {
    scrollRef.current = element;
  },
  getScrollElement: () => scrollRef.current,
  isAtBottom: true,
  isFollowingOutput: () => followRef.current,
  registerScrollWriter: () => () => undefined,
  scrollToBottom: () => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  },
};

interface TurnListProps {
  turns: ConversationTurn[];
  onInitialTailPositioned?: () => void;
  renderAll: boolean;
  renderTurn: (turn: ConversationTurn, index: number) => React.ReactNode;
}

const renderList = (viewport: HTMLElement, props: TurnListProps) =>
  render(
    React.createElement(
      ConversationViewportContext.Provider,
      { value: mockViewportValue },
      React.createElement(VirtualizedTurnList, props),
    ),
    { container: viewport },
  );

const rerenderList = (view: ReturnType<typeof render>, props: TurnListProps) => {
  view.rerender(
    React.createElement(
      ConversationViewportContext.Provider,
      { value: mockViewportValue },
      React.createElement(VirtualizedTurnList, props),
    ),
  );
};

class TestResizeObserver implements ResizeObserver {
  static instances = new Set<TestResizeObserver>();

  private readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.add(this);
  }

  disconnect(): void {
    this.targets.clear();
    TestResizeObserver.instances.delete(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  static flush(): void {
    for (const observer of TestResizeObserver.instances) {
      const entries = Array.from(observer.targets, target => {
        const element = target as HTMLElement;
        return {
          target,
          borderBoxSize: [
            {
              blockSize: element.offsetHeight,
              inlineSize: element.offsetWidth,
            },
          ],
        } as unknown as ResizeObserverEntry;
      });
      if (entries.length > 0) {
        observer.callback(entries, observer);
      }
    }
  }
}

const makeTurns = (count: number, prefix = 'turn'): ConversationTurn[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    userMessage: null,
    assistantItems: [],
  }));

const flushResizeObservers = async (afterPass?: () => void): Promise<void> => {
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => {
      TestResizeObserver.flush();
      await Promise.resolve();
    });
    await act(
      () =>
        new Promise<void>(resolve => {
          requestAnimationFrame(() => resolve());
        }),
    );
    afterPass?.();
  }
};

const installViewport = (): HTMLElement => {
  const viewport = document.createElement('div');
  let scrollTop = 0;

  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: VIEWPORT_HEIGHT },
    offsetHeight: { configurable: true, value: VIEWPORT_HEIGHT },
    offsetWidth: { configurable: true, value: 900 },
    scrollHeight: {
      configurable: true,
      get: () => {
        const sizer = viewport.firstElementChild as HTMLElement | null;
        const rowEnds = Array.from(
          viewport.querySelectorAll<HTMLElement>('[data-index]'),
          row => Number.parseFloat(row.style.top) + row.offsetHeight,
        );
        return Math.max(Number.parseFloat(sizer?.style.height ?? '') || 0, ...rowEnds);
      },
    },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: value => {
        scrollTop = Math.max(
          0,
          Math.min(Number(value), Math.max(viewport.scrollHeight - viewport.clientHeight, 0)),
        );
      },
    },
  });
  viewport.scrollTo = vi.fn(options => {
    viewport.scrollTop =
      typeof options === 'number' ? options : (options.top ?? viewport.scrollTop);
    queueMicrotask(() => viewport.dispatchEvent(new Event('scroll')));
  }) as typeof viewport.scrollTo;
  viewport.addEventListener('scroll', () => {
    // Mirror the real hook's follow rule. Programmatic writes from the
    // virtualizer go through scrollTo (async microtask); treat every scroll
    // event uniformly: landing at the bottom re-arms, anything else stops.
    const maxScroll = Math.max(viewport.scrollHeight - viewport.clientHeight, 0);
    followRef.current = Math.abs(viewport.scrollTop - maxScroll) <= 1;
  });
  document.body.append(viewport);
  scrollRef.current = viewport;
  return viewport;
};

beforeEach(() => {
  // The virtualizer's scroll debounce survives unmount. Keep its timers
  // inside this fixture's lifetime instead of letting them outlive jsdom.
  const viewportWindow: Window = window;
  const setViewportTimeout = viewportWindow.setTimeout.bind(viewportWindow);
  vi.spyOn(viewportWindow, 'setTimeout').mockImplementation((handler, timeout, ...args) => {
    const handle = setViewportTimeout(handler, timeout, ...args);
    viewportTimeouts.add(handle);
    return handle;
  });
  TestResizeObserver.instances.clear();
  followRef.current = true;
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      const measured = (this as HTMLElement).querySelector<HTMLElement>('[data-turn-height]');
      return Number(measured?.dataset.turnHeight ?? 0);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 900,
  });
});

afterEach(() => {
  cleanup();
  clearViewportTimeouts();
  scrollRef.current?.remove();
  scrollRef.current = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('cancels pending scroll debounce timers before disposing the viewport', async () => {
  const viewport = installViewport();
  const view = renderList(viewport, {
    turns: makeTurns(100),
    renderAll: false,
    renderTurn: (turn: ConversationTurn) =>
      React.createElement('div', {
        'data-turn-height': '200',
        'data-turn-id': turn.id,
      }),
  });
  await flushResizeObservers();
  clearViewportTimeouts();

  await act(async () => {
    viewport.dispatchEvent(new Event('scroll'));
  });
  const pendingTimeouts = [...viewportTimeouts];
  expect(pendingTimeouts.length).toBeGreaterThan(0);
  const clearTimeout = vi.spyOn(window, 'clearTimeout');

  view.unmount();
  clearViewportTimeouts();

  for (const timeout of pendingTimeouts) {
    expect(clearTimeout).toHaveBeenCalledWith(timeout);
  }
  expect(viewportTimeouts.size).toBe(0);
});

test('renders a short session at the top of a non-overflowing viewport', async () => {
  const viewport = installViewport();
  const turns = makeTurns(1);

  renderList(viewport, {
    turns,
    renderAll: false,
    renderTurn: (turn: ConversationTurn) =>
      React.createElement('div', {
        'data-turn-height': '180',
        'data-turn-id': turn.id,
      }),
  });

  await flushResizeObservers();

  await waitFor(() => {
    expect(viewport.scrollTop).toBe(0);
    expect(viewport.firstElementChild).toHaveStyle({ height: '180px' });
    expect(viewport.querySelector<HTMLElement>('[data-index="0"]')).toHaveStyle({ top: '0px' });
  });
});

test('keeps a long variable-height session at the tail without overlapping rows', async () => {
  const viewport = installViewport();
  const turns = makeTurns(100);
  const heights = new Map(turns.map((turn, index) => [turn.id, 120 + (index % 5) * 70]));
  const renderTurn = (turn: ConversationTurn) =>
    React.createElement('div', {
      'data-turn-height': String(heights.get(turn.id)),
      'data-turn-id': turn.id,
    });

  const view = renderList(viewport, { turns, renderAll: false, renderTurn });

  expect(viewport.querySelector('[data-turn-id="turn-99"]')).not.toBeNull();
  await flushResizeObservers(() => {
    expect(viewport.querySelector('[data-turn-id="turn-99"]')).not.toBeNull();
  });

  await waitFor(() => {
    expect(viewport.scrollTop).toBe(Math.max(viewport.scrollHeight - VIEWPORT_HEIGHT, 0));
    expect(viewport.querySelector('[data-turn-id="turn-99"]')).not.toBeNull();
  });

  for (const row of viewport.querySelectorAll<HTMLElement>('[data-index]')) {
    const turnId = row.querySelector<HTMLElement>('[data-turn-id]')?.dataset.turnId;
    if (turnId) heights.set(turnId, (heights.get(turnId) ?? 0) + 45);
  }
  rerenderList(view, { turns, renderAll: false, renderTurn });
  await flushResizeObservers();

  await waitFor(() => {
    expect(viewport.scrollTop).toBe(Math.max(viewport.scrollHeight - VIEWPORT_HEIGHT, 0));
  });

  const rows = Array.from(viewport.querySelectorAll<HTMLElement>('[data-index]'))
    .map(row => ({
      end: Number.parseFloat(row.style.top) + row.offsetHeight,
      index: Number(row.dataset.index),
      start: Number.parseFloat(row.style.top),
    }))
    .sort((left, right) => left.index - right.index);

  for (let index = 1; index < rows.length; index += 1) {
    expect(rows[index].start).toBeGreaterThanOrEqual(rows[index - 1].end);
  }
});

test('preserves the visible turn and viewport offset when older turns are prepended', async () => {
  const viewport = installViewport();
  const turns = makeTurns(100, 'existing');
  const onInitialTailPositioned = vi.fn();
  const renderTurn = (turn: ConversationTurn) =>
    React.createElement('div', {
      'data-turn-height': '200',
      'data-turn-id': turn.id,
    });
  const view = renderList(viewport, { turns, onInitialTailPositioned, renderAll: false, renderTurn });
  await flushResizeObservers();
  await waitFor(() => expect(onInitialTailPositioned).toHaveBeenCalledOnce());

  await act(async () => {
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    viewport.scrollTop = 15_000;
    viewport.dispatchEvent(new Event('scroll'));
  });
  await flushResizeObservers();

  const anchorRow = Array.from(viewport.querySelectorAll<HTMLElement>('[data-index]')).find(row => {
    const start = Number.parseFloat(row.style.top);
    return start <= viewport.scrollTop && start + row.offsetHeight > viewport.scrollTop;
  });
  const anchorId = anchorRow?.querySelector<HTMLElement>('[data-turn-id]')?.dataset.turnId;
  const anchorOffset = Number.parseFloat(anchorRow?.style.top ?? '0') - viewport.scrollTop;
  expect(anchorId).toBeTruthy();

  const prepended = [...makeTurns(50, 'older'), ...turns];
  rerenderList(view, {
    turns: prepended,
    onInitialTailPositioned,
    renderAll: false,
    renderTurn,
  });
  await flushResizeObservers();

  await waitFor(() => {
    const anchoredContent = viewport.querySelector<HTMLElement>(`[data-turn-id="${anchorId}"]`);
    const anchoredRow = anchoredContent?.closest<HTMLElement>('[data-index]');
    expect(anchoredRow).not.toBeNull();
    expect(Number.parseFloat(anchoredRow?.style.top ?? '0') - viewport.scrollTop).toBe(
      anchorOffset,
    );
  });
});

test('keeps the tail anchored in the same observer delivery when an existing history turn grows', async () => {
  const viewport = installViewport();
  const turns = makeTurns(4);
  const heights = new Map(turns.map(turn => [turn.id, 400]));
  const view = renderList(viewport, {
    turns,
    renderAll: false,
    renderTurn: (turn: ConversationTurn) =>
      React.createElement('div', {
        'data-turn-height': String(heights.get(turn.id)),
        'data-turn-id': turn.id,
      }),
  });
  await flushResizeObservers();

  const tail = viewport.querySelector<HTMLElement>('[data-index="3"]')!;
  const tailOffset = Number.parseFloat(tail.style.top) - viewport.scrollTop;
  const first = view.container.querySelector<HTMLElement>('[data-turn-id="turn-0"]')!;
  // A history page fills a previously truncated turn without remounting its row.
  first.dataset.turnHeight = '1376';

  await act(async () => {
    TestResizeObserver.flush();
    // Assert before React commits or an animation-frame retry can hide a jump.
    expect(viewport.scrollTop).toBe(viewport.scrollHeight - VIEWPORT_HEIGHT);
    expect(Number.parseFloat(tail.style.top) - viewport.scrollTop).toBe(tailOffset);
    await Promise.resolve();
  });
});

test('measures retained rows before painting a history prepend with overflowing content', async () => {
  const viewport = installViewport();
  const turns = makeTurns(1);
  let tailHeight = 1370;
  const renderTurn = (turn: ConversationTurn) =>
    React.createElement('div', {
      'data-turn-height': String(turn.id === turns[0].id ? tailHeight : 100),
      'data-turn-id': turn.id,
    });
  const view = renderList(viewport, { turns, renderAll: false, renderTurn });
  await flushResizeObservers();
  tailHeight = 2275;

  rerenderList(view, {
    turns: [...makeTurns(2, 'older'), ...turns],
    renderAll: false,
    renderTurn,
  });

  // The growing retained row can overflow the cached sizer before its observer fires.
  expect(viewport.firstElementChild).toHaveStyle({ height: '2475px' });
  expect(viewport.scrollTop).toBe(viewport.scrollHeight - VIEWPORT_HEIGHT);
  const tail = viewport.querySelector<HTMLElement>('[data-turn-id="turn-0"]')!;
  expect(tail.getAttribute('data-turn-height')).toBe('2275');
});

test('compensates a resize above a scrolled-up viewport before the next frame', async () => {
  const viewport = installViewport();
  renderList(viewport, {
    turns: makeTurns(10),
    renderAll: false,
    renderTurn: (turn: ConversationTurn) =>
      React.createElement('div', {
        'data-turn-height': '400',
        'data-turn-id': turn.id,
      }),
  });
  await flushResizeObservers();
  await act(async () => {
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    viewport.scrollTop = 2800;
    viewport.dispatchEvent(new Event('scroll'));
  });
  await flushResizeObservers();

  const anchor = viewport.querySelector<HTMLElement>('[data-index="7"]')!;
  const anchorOffset = Number.parseFloat(anchor.style.top) - viewport.scrollTop;
  const first = viewport.querySelector<HTMLElement>('[data-turn-id="turn-0"]')!;
  // Forward scroll permits remeasurement compensation while still away from the tail.
  await act(async () => {
    viewport.scrollTop = 2900;
    viewport.dispatchEvent(new Event('scroll'));
  });
  first.dataset.turnHeight = '500';
  await act(async () => {
    TestResizeObserver.flush();
    expect(Number.parseFloat(anchor.style.top) - viewport.scrollTop).toBe(anchorOffset - 100);
    expect(viewport.scrollTop).toBeLessThan(viewport.scrollHeight - VIEWPORT_HEIGHT);
    await Promise.resolve();
  });
});

test('preserves visible content when a missing turn prefix is prepended', async () => {
  const viewport = installViewport();
  const turns = makeTurns(100, 'existing').map(turn => ({
    ...turn,
    assistantItems: [
      {
        type: 'assistant' as const,
        message: {
          id: `${turn.id}-content`,
          type: 'assistant' as const,
          content: 'existing content',
          timestamp: 1,
        },
      },
    ],
  }));
  const heights = new Map(turns.map(turn => [turn.id, 200]));
  const prefixHeights = new Map<string, number>();
  const renderTurn = (turn: ConversationTurn) =>
    React.createElement('div', {
      'data-turn-height': String(heights.get(turn.id)),
      'data-turn-id': turn.id,
    });
  const view = renderList(viewport, { turns, renderAll: false, renderTurn });
  await flushResizeObservers();

  await act(async () => {
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    viewport.scrollTop = 15_000;
    viewport.dispatchEvent(new Event('scroll'));
  });
  await flushResizeObservers();

  const anchorRow = Array.from(viewport.querySelectorAll<HTMLElement>('[data-index]')).find(row => {
    const start = Number.parseFloat(row.style.top);
    return start <= viewport.scrollTop && start + row.offsetHeight > viewport.scrollTop;
  });
  const anchorId = anchorRow?.querySelector<HTMLElement>('[data-turn-id]')?.dataset.turnId;
  const originalContentOffset = Number.parseFloat(anchorRow?.style.top ?? '0') - viewport.scrollTop;
  expect(anchorId).toBeTruthy();

  heights.set(anchorId!, (heights.get(anchorId!) ?? 0) + 400);
  prefixHeights.set(anchorId!, 400);
  const expandedTurns = turns.map(turn =>
    turn.id === anchorId
      ? {
          ...turn,
          assistantItems: [
            {
              type: 'assistant' as const,
              message: {
                id: `${turn.id}-prefix`,
                type: 'assistant' as const,
                content: 'newly loaded prefix',
                timestamp: 1,
              },
            },
            ...turn.assistantItems,
          ],
        }
      : turn,
  );
  rerenderList(view, {
    turns: [...makeTurns(50, 'older'), ...expandedTurns],
    renderAll: false,
    renderTurn,
  });
  await flushResizeObservers();

  await waitFor(() => {
    const anchoredContent = viewport.querySelector<HTMLElement>(`[data-turn-id="${anchorId}"]`);
    const anchoredRow = anchoredContent?.closest<HTMLElement>('[data-index]');
    const retainedContentOffset =
      Number.parseFloat(anchoredRow?.style.top ?? '0') +
      (prefixHeights.get(anchorId!) ?? 0) -
      viewport.scrollTop;
    expect(retainedContentOffset).toBe(originalContentOffset);
  });
});

test('finishes initial tail positioning when history is prepended concurrently', async () => {
  const viewport = installViewport();
  const initialTurns = makeTurns(10, 'recent');
  const onInitialTailPositioned = vi.fn();
  const renderTurn = (turn: ConversationTurn) =>
    React.createElement('div', {
      'data-turn-height': '200',
      'data-turn-id': turn.id,
    });
  const view = renderList(viewport, {
    turns: initialTurns,
    onInitialTailPositioned,
    renderAll: false,
    renderTurn,
  });

  rerenderList(view, {
    turns: [...makeTurns(10, 'older'), ...initialTurns],
    onInitialTailPositioned,
    renderAll: false,
    renderTurn,
  });
  await flushResizeObservers();

  await waitFor(() => {
    expect(onInitialTailPositioned).toHaveBeenCalledOnce();
    expect(viewport.scrollTop).toBe(Math.max(viewport.scrollHeight - VIEWPORT_HEIGHT, 0));
    expect(viewport.querySelector('[data-turn-id="recent-9"]')).not.toBeNull();
  });
});

test('follows streaming tail growth while at the bottom and stops after scrolling up', async () => {
  const viewport = installViewport();
  const turns = makeTurns(20);
  const heights = new Map(turns.map(turn => [turn.id, 200]));
  const renderTurn = (turn: ConversationTurn) =>
    React.createElement('div', {
      'data-turn-height': String(heights.get(turn.id)),
      'data-turn-id': turn.id,
    });
  const view = renderList(viewport, { turns, renderAll: false, renderTurn });
  await flushResizeObservers();
  await waitFor(() => {
    expect(viewport.scrollTop).toBe(Math.max(viewport.scrollHeight - VIEWPORT_HEIGHT, 0));
  });

  // Streaming growth of the tail turn: still following, stays at the bottom.
  heights.set('turn-19', 640);
  rerenderList(view, { turns, renderAll: false, renderTurn });
  await flushResizeObservers();
  await waitFor(() => {
    expect(viewport.scrollTop).toBe(Math.max(viewport.scrollHeight - VIEWPORT_HEIGHT, 0));
  });

  // User scrolls up: the same growth must not yank them back down.
  let observedWhileScrolledUp = -1;
  const writes: Array<[string, number]> = [];
  const originalScrollTo = viewport.scrollTo;
  viewport.scrollTo = ((options: ScrollToOptions | number) => {
    writes.push([
      typeof options === 'number' ? String(options) : `${options.top}:${options.behavior}`,
      typeof options === 'number' ? options : (options.top ?? viewport.scrollTop),
    ]);
    return originalScrollTo(options);
  }) as typeof viewport.scrollTo;
  viewport.addEventListener('scroll', () => {
    writes.push(['scroll-event', viewport.scrollTop]);
  });
  await act(async () => {
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    viewport.scrollTop = 1200;
    viewport.dispatchEvent(new Event('scroll'));
    observedWhileScrolledUp = viewport.scrollTop;
  });
  console.log('[follow-test] after user scroll:', JSON.stringify(writes));
  await flushResizeObservers();
  console.log('[follow-test] after flush:', JSON.stringify(writes), 'scrollTop:', viewport.scrollTop);
  expect(observedWhileScrolledUp).toBe(1200);

  heights.set('turn-19', 1040);
  rerenderList(view, { turns, renderAll: false, renderTurn });
  await flushResizeObservers();
  console.log('[follow-test] final:', JSON.stringify(writes), 'scrollTop:', viewport.scrollTop);
  // The virtualizer anchors measurements above the viewport, so scrollTop may
  // legitimately shift by the above-viewport growth delta; it must stay in the
  // scrolled-up region, never snap back to the tail.
  expect(viewport.scrollTop).toBeGreaterThanOrEqual(1200);
  expect(viewport.scrollTop).toBeLessThan(viewport.scrollHeight - VIEWPORT_HEIGHT - 1);
});
