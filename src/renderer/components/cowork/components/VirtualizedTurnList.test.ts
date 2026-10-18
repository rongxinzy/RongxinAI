// @vitest-environment jsdom

import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import { ConversationViewportProvider } from '@shared/components/ai-elements/useConversationViewport';

import type { ConversationTurn } from '../helpers/messageGrouping';
import { VirtualizedTurnList, type VirtualizedTurnListProps } from './VirtualizedTurnList';

const mocks = vi.hoisted(() => ({
  elementScroll: vi.fn(),
  measureElement: vi.fn(),
  scrollRef: { current: null as HTMLDivElement | null },
  scrollToEnd: vi.fn(),
  scrollToIndex: vi.fn(),
  useVirtualizer: vi.fn(),
}));

vi.mock('@tanstack/react-virtual', () => ({
  elementScroll: mocks.elementScroll,
  useVirtualizer: (options: unknown) => mocks.useVirtualizer(options),
}));

const makeViewportValue = () => ({
  attachContentElement: vi.fn(),
  attachScrollElement: (element: HTMLDivElement | null) => {
    mocks.scrollRef.current = element;
  },
  getScrollElement: () => mocks.scrollRef.current,
  isAtBottom: true,
  isFollowingOutput: () => true,
  registerScrollWriter: () => () => undefined,
  scrollToBottom: vi.fn(),
});

const renderList = (props: VirtualizedTurnListProps & { key?: string }) =>
  render(
    React.createElement(
      ConversationViewportProvider,
      { value: makeViewportValue() },
      React.createElement(VirtualizedTurnList, props),
    ),
  );

const rerenderList = (
  view: ReturnType<typeof render>,
  props: VirtualizedTurnListProps & { key?: string },
) => {
  view.rerender(
    React.createElement(
      ConversationViewportProvider,
      { value: makeViewportValue() },
      React.createElement(VirtualizedTurnList, props),
    ),
  );
};

beforeEach(() => {
  mocks.scrollRef.current = document.createElement('div');
  mocks.elementScroll.mockReset();
  mocks.measureElement.mockReset();
  mocks.scrollToEnd.mockReset();
  mocks.scrollToIndex.mockReset();
  mocks.useVirtualizer.mockReset();
  mocks.useVirtualizer.mockReturnValue({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    measureElement: mocks.measureElement,
    scrollToEnd: mocks.scrollToEnd,
    scrollToIndex: mocks.scrollToIndex,
  });
});

test('starts at the estimated end and anchors dynamic measurements to the end', () => {
  renderList({
    turns: [],
    renderAll: false,
    renderTurn: () => null,
  });

  expect(mocks.useVirtualizer).toHaveBeenCalledWith(
    expect.objectContaining({
      anchorTo: 'end',
      followOnAppend: true,
      initialOffset: 0,
      initialRect: { width: 0, height: 1200 },
    }),
  );
  expect(mocks.scrollToEnd).toHaveBeenCalledWith({ behavior: 'auto' });
});

test('positions a newly mounted virtualizer at the end before paint', () => {
  const view = renderList({
    key: 'session-1',
    turns: [],
    renderAll: false,
    renderTurn: () => null,
  });

  rerenderList(view, {
    key: 'session-2',
    turns: [],
    renderAll: false,
    renderTurn: () => null,
  });

  expect(mocks.scrollToEnd).toHaveBeenCalledTimes(2);
});

test('positions the initial tail once before enabling history pagination', () => {
  const onInitialTailPositioned = vi.fn();

  renderList({
    turns: [],
    onInitialTailPositioned,
    renderAll: false,
    renderTurn: () => null,
  });

  expect(mocks.scrollToEnd).toHaveBeenCalledTimes(1);
  expect(onInitialTailPositioned).toHaveBeenCalledOnce();
});

test('does not retry internal anchor adjustments while the user scrolls upward', () => {
  const scrollElement = mocks.scrollRef.current!;
  Object.defineProperties(scrollElement, {
    clientHeight: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: 2_000 },
    scrollTop: { configurable: true, writable: true, value: 500 },
  });
  const requestFrame = vi.spyOn(window, 'requestAnimationFrame');

  renderList({
    turns: [],
    renderAll: false,
    renderTurn: () => null,
  });

  const options = mocks.useVirtualizer.mock.calls[0]?.[0] as {
    scrollToFn: (
      offset: number,
      options: { adjustments?: number; behavior?: ScrollBehavior },
      instance: {
        scrollElement: HTMLElement;
        elementsCache: Map<React.Key, HTMLElement>;
        getTotalSize: () => number;
        getVirtualItems: () => [];
      },
    ) => void;
  };
  options.scrollToFn(
    1_000,
    { adjustments: 200 },
    {
      scrollElement,
      elementsCache: new Map(),
      getTotalSize: () => 2_000,
      getVirtualItems: () => [],
    },
  );

  expect(mocks.elementScroll).toHaveBeenCalledOnce();
  expect(requestFrame).not.toHaveBeenCalled();
  requestFrame.mockRestore();
});

test('lets a short session clamp its estimated end to the top of a non-overflowing viewport', () => {
  const turns: ConversationTurn[] = [
    {
      id: 'turn-1',
      userMessage: null,
      assistantItems: [],
    },
  ];

  renderList({
    turns,
    renderAll: false,
    renderTurn: () => null,
  });

  expect(mocks.useVirtualizer).toHaveBeenCalledWith(
    expect.objectContaining({ initialOffset: 300 }),
  );
});

test('does not call scrollToEnd again after the initial tail position', () => {
  const view = renderList({
    turns: [],
    renderAll: false,
    renderTurn: () => null,
  });

  expect(mocks.scrollToEnd).toHaveBeenCalledTimes(1);

  rerenderList(view, { turns: [], renderAll: false, renderTurn: () => null });
  rerenderList(view, { turns: [], renderAll: false, renderTurn: () => null });

  expect(mocks.scrollToEnd).toHaveBeenCalledTimes(1);
});

test('positions only the virtual tail window instead of rendering the full session', () => {
  const turns: ConversationTurn[] = Array.from({ length: 100 }, (_, index) => ({
    id: `turn-${index}`,
    userMessage: null,
    assistantItems: [],
  }));
  const renderTurn = vi.fn((_turn: ConversationTurn, index: number) =>
    React.createElement('div', { 'data-turn-index': index }, 'turn'),
  );
  mocks.useVirtualizer.mockReturnValue({
    getTotalSize: () => 30_000,
    getVirtualItems: () => [{ index: 99, key: 'turn-99', start: 29_700 }],
    measureElement: mocks.measureElement,
    scrollToEnd: mocks.scrollToEnd,
    scrollToIndex: mocks.scrollToIndex,
  });

  const view = renderList({
    turns,
    renderAll: false,
    renderTurn,
  });

  expect(renderTurn).toHaveBeenCalled();
  expect(renderTurn.mock.calls.every(([, index]) => index === 99)).toBe(true);
  expect(mocks.scrollToEnd).toHaveBeenCalledTimes(1);
  expect(view.container.querySelector('.invisible')).toBeNull();

  expect(mocks.useVirtualizer).toHaveBeenCalledWith(
    expect.objectContaining({
      followOnAppend: true,
      initialOffset: 30_000,
    }),
  );
});

test('synchronizes measured layout before the following React commit', () => {
  const turns: ConversationTurn[] = [
    {
      id: 'turn-1',
      userMessage: null,
      assistantItems: [],
    },
  ];
  mocks.useVirtualizer.mockReturnValue({
    getTotalSize: () => 300,
    getVirtualItems: () => [{ index: 0, key: 'turn-1', start: 0 }],
    measureElement: mocks.measureElement,
    scrollToEnd: mocks.scrollToEnd,
    scrollToIndex: mocks.scrollToIndex,
  });

  const view = renderList({
    turns,
    renderAll: false,
    renderTurn: () => React.createElement('div', null, 'turn'),
  });
  rerenderList(view, {
    turns,
    renderAll: false,
    renderTurn: () => React.createElement('div', null, 'turn'),
  });

  const row = view.container.querySelector<HTMLElement>('[data-index="0"]');
  expect(mocks.measureElement).toHaveBeenCalledTimes(1);
  expect(row?.style.top).toBe('0px');
  expect(row?.style.transform).toBe('');

  const options = mocks.useVirtualizer.mock.calls[0]?.[0] as {
    onChange: (instance: {
      elementsCache: Map<React.Key, HTMLElement>;
      getTotalSize: () => number;
      getVirtualItems: () => Array<{ key: React.Key; start: number }>;
    }) => void;
  };
  options.onChange({
    elementsCache: new Map([['turn-1', row!]]),
    getTotalSize: () => 480,
    getVirtualItems: () => [{ key: 'turn-1', start: 120 }],
  });

  expect(
    view.container.querySelector<HTMLElement>('[data-virtualized-turn-list]')?.style.height,
  ).toBe('480px');
  expect(row?.style.top).toBe('120px');
});
