// @vitest-environment jsdom

import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import type { ConversationTurn } from '../helpers/messageGrouping';
import { VirtualizedTurnList } from './VirtualizedTurnList';

const mocks = vi.hoisted(() => ({
  scrollRef: { current: null as HTMLElement | null },
  scrollToEnd: vi.fn(),
  scrollToIndex: vi.fn(),
  useVirtualizer: vi.fn(),
}));

vi.mock('use-stick-to-bottom', () => ({
  useStickToBottomContext: () => ({ scrollRef: mocks.scrollRef }),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: unknown) => mocks.useVirtualizer(options),
}));

beforeEach(() => {
  mocks.scrollRef.current = document.createElement('div');
  mocks.scrollToEnd.mockReset();
  mocks.scrollToIndex.mockReset();
  mocks.useVirtualizer.mockReset();
  mocks.useVirtualizer.mockReturnValue({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    measureElement: vi.fn(),
    scrollToEnd: mocks.scrollToEnd,
    scrollToIndex: mocks.scrollToIndex,
  });
});

test('starts at the estimated end and anchors dynamic measurements to the end', () => {
  render(
    React.createElement(VirtualizedTurnList, {
      isStreaming: false,
      turns: [],
      renderAll: false,
      renderTurn: () => null,
    }),
  );

  expect(mocks.useVirtualizer).toHaveBeenCalledWith(
    expect.objectContaining({
      anchorTo: 'end',
      followOnAppend: false,
      initialOffset: 0,
      initialRect: { width: 0, height: 1200 },
    }),
  );
  expect(mocks.scrollToEnd).toHaveBeenCalledWith({ behavior: 'auto' });
  expect(mocks.scrollRef.current?.style.overflowAnchor).toBe('none');
});

test('positions a newly mounted virtualizer at the end before paint', () => {
  const view = render(
    React.createElement(VirtualizedTurnList, {
      key: 'session-1',
      isStreaming: false,
      turns: [],
      renderAll: false,
      renderTurn: () => null,
    }),
  );

  view.rerender(
    React.createElement(VirtualizedTurnList, {
      key: 'session-2',
      isStreaming: false,
      turns: [],
      renderAll: false,
      renderTurn: () => null,
    }),
  );

  expect(mocks.scrollToEnd).toHaveBeenCalledTimes(2);
});

test('lets a short session clamp its estimated end to the top of a non-overflowing viewport', () => {
  const turns: ConversationTurn[] = [
    {
      id: 'turn-1',
      userMessage: null,
      assistantItems: [],
    },
  ];

  render(
    React.createElement(VirtualizedTurnList, {
      isStreaming: false,
      turns,
      renderAll: false,
      renderTurn: () => null,
    }),
  );

  expect(mocks.useVirtualizer).toHaveBeenCalledWith(
    expect.objectContaining({ initialOffset: 300 }),
  );
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
    measureElement: vi.fn(),
    scrollToEnd: mocks.scrollToEnd,
    scrollToIndex: mocks.scrollToIndex,
  });

  const view = render(
    React.createElement(VirtualizedTurnList, {
      isStreaming: true,
      turns,
      renderAll: false,
      renderTurn,
    }),
  );

  expect(renderTurn).toHaveBeenCalled();
  expect(renderTurn.mock.calls.every(([, index]) => index === 99)).toBe(true);
  expect(mocks.scrollToEnd).toHaveBeenCalledTimes(1);
  expect(view.container.querySelector('.invisible')).toBeNull();

  expect(mocks.useVirtualizer).toHaveBeenCalledWith(
    expect.objectContaining({
      followOnAppend: 'auto',
      initialOffset: 30_000,
    }),
  );
});
