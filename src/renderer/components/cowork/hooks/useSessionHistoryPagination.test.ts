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

test('ignores the initial top position until the virtual tail has settled', async () => {
  const { root, scrollElement } = installScrollElement(2_000, 800);
  let markInitialTailPositioned: () => void = () => undefined;

  const Harness = () => {
    markInitialTailPositioned = useSessionHistoryPagination({
      sessionId: 'session-1',
      messagesOffset: 50,
      rootRef: { current: root },
    });
    return null;
  };
  render(React.createElement(Harness));

  scrollElement.dispatchEvent(new Event('scroll'));
  expect(mocks.loadMoreMessages).not.toHaveBeenCalled();

  act(() => markInitialTailPositioned());
  scrollElement.dispatchEvent(new Event('scroll'));

  await waitFor(() => {
    expect(mocks.loadMoreMessages).toHaveBeenCalledOnce();
    expect(mocks.loadMoreMessages).toHaveBeenCalledWith('session-1');
  });
});

test('loads more after settling when real content still does not fill the viewport', async () => {
  const { root } = installScrollElement(400, 800);
  let markInitialTailPositioned: () => void = () => undefined;

  const Harness = () => {
    markInitialTailPositioned = useSessionHistoryPagination({
      sessionId: 'session-1',
      messagesOffset: 50,
      rootRef: { current: root },
    });
    return null;
  };
  render(React.createElement(Harness));

  expect(mocks.loadMoreMessages).not.toHaveBeenCalled();
  act(() => markInitialTailPositioned());

  await waitFor(() => {
    expect(mocks.loadMoreMessages).toHaveBeenCalledWith('session-1');
  });
});

test('prefetches before the user reaches the top edge', async () => {
  const { root, scrollElement } = installScrollElement(4_000, 800);
  scrollElement.scrollTop = 1_700;
  let markInitialTailPositioned: () => void = () => undefined;

  const Harness = () => {
    markInitialTailPositioned = useSessionHistoryPagination({
      sessionId: 'session-1',
      messagesOffset: 50,
      rootRef: { current: root },
    });
    return null;
  };
  render(React.createElement(Harness));
  act(() => markInitialTailPositioned());

  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(mocks.loadMoreMessages).not.toHaveBeenCalled();

  scrollElement.scrollTop = 1_500;
  scrollElement.dispatchEvent(new Event('scroll'));

  await waitFor(() => expect(mocks.loadMoreMessages).toHaveBeenCalledWith('session-1'));
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
  act(() => markInitialTailPositioned());

  await waitFor(() => expect(mocks.loadMoreMessages).toHaveBeenCalledTimes(1));

  view.rerender(React.createElement(Harness, { messagesOffset: 50 }));
  await waitFor(() => expect(mocks.loadMoreMessages).toHaveBeenCalledTimes(2));
});
