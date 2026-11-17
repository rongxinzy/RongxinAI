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

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect(): void {}
      observe(): void {}
      unobserve(): void {}
    },
  );
  document.body.replaceChildren();
});

test('renders role="log" container with normal-flow flex column and scrollClassName', () => {
  const { container } = render(
    React.createElement(
      Conversation,
      { className: 'h-full' },
      React.createElement(
        TestConversationContent,
        { scrollClassName: 'cowork-conversation-scroll' },
        'message',
      ),
    ),
  );

  const log = container.querySelector<HTMLElement>('[role="log"]');
  expect(log).not.toBeNull();
  expect(container.textContent).toBe('message');

  const scrollElement = container.querySelector<HTMLElement>('.cowork-conversation-scroll');
  expect(scrollElement).not.toBeNull();
  expect(scrollElement).toHaveClass('min-w-0', 'overflow-x-hidden', 'overflow-y-auto');

  const flow = scrollElement?.firstElementChild as HTMLElement | null;
  expect(flow?.className).toContain('flex-col');
  expect(flow?.className).not.toContain('flex-col-reverse');
});

test('supports explicit reverse flex flow when requested', () => {
  const { container } = render(
    React.createElement(
      Conversation,
      null,
      React.createElement(
        TestConversationContent,
        { reverse: true, scrollClassName: 'conversation-scroll' },
        'message',
      ),
    ),
  );

  const scrollElement = container.querySelector<HTMLElement>('.conversation-scroll');
  const flow = scrollElement?.firstElementChild as HTMLElement | null;
  expect(flow?.className).toContain('flex-col-reverse');
});
