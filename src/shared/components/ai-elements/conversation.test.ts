// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
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

/** ResizeObserver double whose flush() reports every target at one height. */
class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  private readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  disconnect(): void {
    this.targets.clear();
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  flush(height: number): void {
    const entries = Array.from(this.targets, target => ({
      target,
      contentRect: { height, width: 100 },
    })) as unknown as ResizeObserverEntry[];
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

const installViewport = () => {
  const container = document.createElement('div');
  document.body.append(container);
  return container;
};

const makeScrollElement = (container: HTMLElement) => {
  const scrollElement = container.querySelector<HTMLElement>('.conversation-scroll');
  if (!scrollElement) throw new Error('scroll element not rendered');
  return scrollElement;
};

const makeScrollable = (element: HTMLElement) => {
  let contentHeight = 400;
  let scrollTop = 0;
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => contentHeight,
  });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 300 });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: value => {
      scrollTop = Math.max(0, Math.min(value, Math.max(contentHeight - 300, 0)));
    },
  });
  return {
    setContentHeight(height: number) {
      contentHeight = height;
    },
    setScrollTop(value: number) {
      scrollTop = value;
    },
    get scrollTop() {
      return scrollTop;
    },
  };
};

beforeEach(() => {
  resizeObserverMocks.disconnect.mockReset();
  resizeObserverMocks.observe.mockReset();
  TestResizeObserver.instances = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = resizeObserverMocks.disconnect;
      observe = resizeObserverMocks.observe;
    },
  );
  document.body.replaceChildren();
});

test('renders the scroll container in normal flow for virtualized conversation content', () => {
  const container = installViewport();
  render(
    React.createElement(
      Conversation,
      { className: 'h-full' },
      React.createElement(
        TestConversationContent,
        { observeContentResize: false, reverse: false, scrollClassName: 'conversation-scroll' },
        'message',
      ),
    ),
    { container },
  );

  expect(container.textContent).toBe('message');
  const scrollElement = makeScrollElement(container);
  const flow = scrollElement.firstElementChild as HTMLElement;
  expect(flow.className).toContain('flex-col');
  expect(flow.className).not.toContain('flex-col-reverse');
});

test('can leave content resize handling to an external virtualizer', () => {
  const container = installViewport();
  render(
    React.createElement(
      Conversation,
      null,
      React.createElement(TestConversationContent, { observeContentResize: false }, 'message'),
    ),
    { container },
  );

  expect(resizeObserverMocks.observe).not.toHaveBeenCalled();
});

test('observes content resize by default', () => {
  const container = installViewport();
  render(
    React.createElement(
      Conversation,
      null,
      React.createElement(TestConversationContent, null, 'message'),
    ),
    { container },
  );

  expect(resizeObserverMocks.observe).toHaveBeenCalledTimes(1);
});

test('keeps horizontal overflow inside message content', () => {
  const container = installViewport();
  render(
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
    { container },
  );

  const scrollElement = container.querySelector<HTMLElement>('.cowork-conversation-scroll');
  expect(scrollElement).not.toBeNull();
  expect(scrollElement).toHaveClass('min-w-0', 'overflow-x-hidden', 'overflow-y-auto');
});

test('content growth while at the bottom keeps the viewport at the bottom', () => {
  const container = installViewport();
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  render(
    React.createElement(
      Conversation,
      null,
      React.createElement(
        TestConversationContent,
        { reverse: false, scrollClassName: 'conversation-scroll' },
        'message',
      ),
    ),
    { container },
  );

  const scrollElement = makeScrollElement(container);
  const model = makeScrollable(scrollElement);

  act(() => {
    TestResizeObserver.instances[0]!.flush(400);
  });
  expect(model.scrollTop).toBe(0); // first observation never scrolls

  model.setScrollTop(100); // bottom of 400px content in a 300px viewport
  act(() => {
    scrollElement.dispatchEvent(new Event('scroll'));
  });

  model.setContentHeight(600); // output grows while following
  act(() => {
    TestResizeObserver.instances[0]!.flush(600);
  });
  expect(model.scrollTop).toBe(300); // bottom of grown content
});

test('content growth after the user scrolled up keeps their position', () => {
  const container = installViewport();
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  render(
    React.createElement(
      Conversation,
      null,
      React.createElement(
        TestConversationContent,
        { reverse: false, scrollClassName: 'conversation-scroll' },
        'message',
      ),
    ),
    { container },
  );

  const scrollElement = makeScrollElement(container);
  const model = makeScrollable(scrollElement);

  act(() => {
    TestResizeObserver.instances[0]!.flush(400);
  });
  model.setScrollTop(100);
  act(() => {
    scrollElement.dispatchEvent(new Event('scroll'));
  });

  // User scrolls up: 400→300 in a 300px viewport means scrollTop 0.
  model.setScrollTop(0);
  act(() => {
    scrollElement.dispatchEvent(new Event('scroll'));
  });

  model.setContentHeight(600);
  act(() => {
    TestResizeObserver.instances[0]!.flush(600);
  });
  expect(model.scrollTop).toBe(0); // stays where the user is reading
});
