// @vitest-environment jsdom

import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import { Conversation, ConversationContent, type ConversationContentProps } from './conversation';

type TestConversationContentProps = Omit<ConversationContentProps, 'children'> & {
  children?: React.ReactNode;
};
const TestConversationContent =
  ConversationContent as React.ComponentType<TestConversationContentProps>;

const resizeObserverMocks = vi.hoisted(() => ({
  disconnect: vi.fn(),
  observe: vi.fn(),
}));

beforeEach(() => {
  resizeObserverMocks.disconnect.mockReset();
  resizeObserverMocks.observe.mockReset();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = resizeObserverMocks.disconnect;
      observe = resizeObserverMocks.observe;
    },
  );
});

test('can leave content resize handling to an external virtualizer', () => {
  render(
    React.createElement(
      Conversation,
      null,
      React.createElement(TestConversationContent, { observeContentResize: false }, 'message'),
    ),
  );

  expect(resizeObserverMocks.observe).not.toHaveBeenCalled();
});

test('observes content resize by default', () => {
  render(
    React.createElement(
      Conversation,
      null,
      React.createElement(TestConversationContent, null, 'message'),
    ),
  );

  expect(resizeObserverMocks.observe).toHaveBeenCalledTimes(1);
});
