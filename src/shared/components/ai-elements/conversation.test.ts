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

test('supports normal flow for virtualized conversation content', () => {
  const view = render(
    React.createElement(
      Conversation,
      null,
      React.createElement(
        TestConversationContent,
        { observeContentResize: false, reverse: false },
        'message',
      ),
    ),
  );

  const content = view.getByText('message');
  expect(content).toHaveClass('flex-col');
  expect(content).not.toHaveClass('flex-col-reverse');
});

test('keeps horizontal overflow inside message content', () => {
  const view = render(
    React.createElement(
      Conversation,
      null,
      React.createElement(
        TestConversationContent,
        {
          observeContentResize: false,
          scrollClassName: 'cowork-conversation-scroll',
        },
        'message',
      ),
    ),
  );

  const content = view.getByText('message');
  expect(content).toHaveClass('min-w-0');
  expect(content.parentElement).toHaveClass(
    'cowork-conversation-scroll',
    'min-w-0',
    'overflow-x-hidden',
    'overflow-y-auto',
  );
});
