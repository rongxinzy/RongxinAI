// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { ConversationTurn } from '../helpers/messageGrouping';
import { VirtualizedTurnList } from './VirtualizedTurnList';

const VIEWPORT_HEIGHT = 600;
const scrollRef = { current: null as HTMLElement | null };

vi.mock('use-stick-to-bottom', () => ({
  useStickToBottomContext: () => ({ scrollRef }),
}));

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
      get: () =>
        Number.parseFloat((viewport.firstElementChild as HTMLElement | null)?.style.height ?? '') ||
        0,
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
  document.body.append(viewport);
  scrollRef.current = viewport;
  return viewport;
};

beforeEach(() => {
  TestResizeObserver.instances.clear();
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
  scrollRef.current?.remove();
  scrollRef.current = null;
  vi.unstubAllGlobals();
});

test('renders a short session at the top of a non-overflowing viewport', async () => {
  const viewport = installViewport();
  const turns = makeTurns(1);

  render(
    React.createElement(VirtualizedTurnList, {
      isStreaming: false,
      turns,
      renderAll: false,
      renderTurn: (turn: ConversationTurn) =>
        React.createElement('div', {
          'data-turn-height': '180',
          'data-turn-id': turn.id,
        }),
    }),
    { container: viewport },
  );

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

  const view = render(
    React.createElement(VirtualizedTurnList, {
      isStreaming: false,
      turns,
      renderAll: false,
      renderTurn,
    }),
    { container: viewport },
  );

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
  view.rerender(
    React.createElement(VirtualizedTurnList, {
      isStreaming: false,
      turns,
      renderAll: false,
      renderTurn,
    }),
  );
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
  const renderTurn = (turn: ConversationTurn) =>
    React.createElement('div', {
      'data-turn-height': '200',
      'data-turn-id': turn.id,
    });
  const view = render(
    React.createElement(VirtualizedTurnList, {
      isStreaming: false,
      turns,
      renderAll: false,
      renderTurn,
    }),
    { container: viewport },
  );
  await flushResizeObservers();

  await act(async () => {
    viewport.scrollTop = 15_000;
    viewport.dispatchEvent(new Event('scroll'));
  });

  const anchorRow = Array.from(viewport.querySelectorAll<HTMLElement>('[data-index]')).find(row => {
    const start = Number.parseFloat(row.style.top);
    return start <= viewport.scrollTop && start + row.offsetHeight > viewport.scrollTop;
  });
  const anchorId = anchorRow?.querySelector<HTMLElement>('[data-turn-id]')?.dataset.turnId;
  const anchorOffset = Number.parseFloat(anchorRow?.style.top ?? '0') - viewport.scrollTop;
  expect(anchorId).toBeTruthy();

  const prepended = [...makeTurns(50, 'older'), ...turns];
  view.rerender(
    React.createElement(VirtualizedTurnList, {
      isStreaming: false,
      turns: prepended,
      renderAll: false,
      renderTurn,
    }),
  );
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
