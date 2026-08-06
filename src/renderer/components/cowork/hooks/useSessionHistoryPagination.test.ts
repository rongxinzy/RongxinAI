// @vitest-environment jsdom

import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import { useSessionHistoryPagination } from './useSessionHistoryPagination';

const mocks = vi.hoisted(() => ({
  loadMoreMessages: vi.fn(),
}));

vi.mock('../../../services/cowork', () => ({
  coworkService: {
    loadMoreMessages: mocks.loadMoreMessages,
  },
}));

const installScrollElement = (scrollHeight: number, clientHeight: number) => {
  const root = document.createElement('div');
  const scrollElement = document.createElement('div');
  scrollElement.className = 'cowork-conversation-scroll';
  Object.defineProperties(scrollElement, {
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, value: scrollHeight },
    scrollTop: { configurable: true, writable: true, value: 0 },
  });
  root.append(scrollElement);
  document.body.append(root);
  return { root, scrollElement };
};

beforeEach(() => {
  mocks.loadMoreMessages.mockReset();
  mocks.loadMoreMessages.mockResolvedValue(true);
  document.body.replaceChildren();
});

test('prefetches history before the virtual tail has settled', async () => {
  const { root } = installScrollElement(2_000, 800);
  const Harness = () => {
    useSessionHistoryPagination({
      sessionId: 'session-1',
      messagesOffset: 50,
      rootRef: { current: root },
    });
    return null;
  };
  render(React.createElement(Harness));

  await waitFor(() => {
    expect(mocks.loadMoreMessages).toHaveBeenCalledOnce();
    expect(mocks.loadMoreMessages).toHaveBeenCalledWith('session-1');
  });
});

test('keeps priming history before settling when content does not fill the viewport', async () => {
  const { root } = installScrollElement(400, 800);

  const Harness = ({ messagesOffset }: { messagesOffset: number }) => {
    useSessionHistoryPagination({
      sessionId: 'session-1',
      messagesOffset,
      rootRef: { current: root },
    });
    return null;
  };
  const view = render(React.createElement(Harness, { messagesOffset: 100 }));

  await waitFor(() => expect(mocks.loadMoreMessages).toHaveBeenCalledTimes(1));
  view.rerender(React.createElement(Harness, { messagesOffset: 50 }));

  await waitFor(() => expect(mocks.loadMoreMessages).toHaveBeenCalledTimes(2));
});

test('prefetches before the user reaches the top edge', async () => {
  const { root, scrollElement } = installScrollElement(8_000, 800);
  scrollElement.scrollTop = 2_500;
  let markInitialTailPositioned: () => void = () => undefined;

  const Harness = ({ messagesOffset }: { messagesOffset: number }) => {
    markInitialTailPositioned = useSessionHistoryPagination({
      sessionId: 'session-1',
      messagesOffset,
      rootRef: { current: root },
    });
    return null;
  };
  const view = render(React.createElement(Harness, { messagesOffset: 100 }));
  await waitFor(() => expect(mocks.loadMoreMessages).toHaveBeenCalledTimes(1));
  act(() => markInitialTailPositioned());
  view.rerender(React.createElement(Harness, { messagesOffset: 50 }));

  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(mocks.loadMoreMessages).toHaveBeenCalledTimes(1);

  scrollElement.scrollTop = 2_300;
  scrollElement.dispatchEvent(new Event('scroll'));

  await waitFor(() => expect(mocks.loadMoreMessages).toHaveBeenCalledTimes(2));
});

test('keeps filling the viewport buffer after a page is prepended', async () => {
  const { root, scrollElement } = installScrollElement(8_000, 800);
  scrollElement.scrollTop = 1_500;
  let markInitialTailPositioned: () => void = () => undefined;

  const Harness = ({ messagesOffset }: { messagesOffset: number }) => {
    markInitialTailPositioned = useSessionHistoryPagination({
      sessionId: 'session-1',
      messagesOffset,
      rootRef: { current: root },
    });
    return null;
  };
  const view = render(React.createElement(Harness, { messagesOffset: 100 }));
  await waitFor(() => expect(mocks.loadMoreMessages).toHaveBeenCalledTimes(1));
  act(() => markInitialTailPositioned());

  view.rerender(React.createElement(Harness, { messagesOffset: 50 }));
  await waitFor(() => expect(mocks.loadMoreMessages).toHaveBeenCalledTimes(2));
});
