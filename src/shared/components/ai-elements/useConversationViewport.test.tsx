// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import React, { useEffect } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import {
  useConversationViewport,
  useConversationViewportContext,
} from './useConversationViewport';

const observe = vi.fn();

beforeEach(() => {
  observe.mockReset();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = observe;
      disconnect(): void {}
      unobserve(): void {}
    },
  );
  document.body.replaceChildren();
});

/** jsdom scroll element with clamped scrollTop and controllable geometry. */
const installScrollElement = () => {
  const element = document.createElement('div');
  let contentHeight = 1000;
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
  document.body.append(element);
  return {
    element,
    setContentHeight(height: number) {
      contentHeight = height;
    },
    setScrollTop(value: number) {
      scrollTop = value;
      element.dispatchEvent(new Event('scroll'));
    },
    get scrollTop() {
      return scrollTop;
    },
  };
};

/**
 * Drives the viewport hook with a real scroll element: attach/detach on
 * command, and expose the live viewport through a ref for assertions.
 */
type HarnessHandle = {
  viewport: ReturnType<typeof useConversationViewport>;
  attach: (element: HTMLDivElement | null) => void;
};

const Harness = ({ handleRef }: { handleRef: React.RefObject<HarnessHandle | null> }) => {
  const viewport = useConversationViewport();
  useEffect(() => {
    handleRef.current = { attach: viewport.attachScrollElement, viewport };
  });
  return null;
};

test('scroll-up stops following; returning to the bottom re-arms the button state', () => {
  const scroll = installScrollElement();
  const handleRef = React.createRef<HarnessHandle | null>();
  render(React.createElement(Harness, { handleRef }));

  act(() => handleRef.current!.attach(scroll.element));
  expect(handleRef.current!.viewport.isAtBottom).toBe(false); // scrollTop 0 of 700

  act(() => scroll.setScrollTop(700));
  expect(handleRef.current!.viewport.isAtBottom).toBe(true);

  act(() => scroll.setScrollTop(400));
  expect(handleRef.current!.viewport.isAtBottom).toBe(false);

  act(() => scroll.setScrollTop(699));
  expect(handleRef.current!.viewport.isAtBottom).toBe(true);
});

test('scrollToBottom writes the clamped bottom offset directly', () => {
  const scroll = installScrollElement();
  const handleRef = React.createRef<HarnessHandle | null>();
  render(React.createElement(Harness, { handleRef }));
  act(() => handleRef.current!.attach(scroll.element));

  act(() => scroll.setScrollTop(120));
  act(() => handleRef.current!.viewport.scrollToBottom());
  expect(scroll.scrollTop).toBe(700);
  expect(handleRef.current!.viewport.isAtBottom).toBe(true);
});

test('a registered writer (virtualizer) replaces direct scrollTop writes', () => {
  const scroll = installScrollElement();
  const handleRef = React.createRef<HarnessHandle | null>();
  render(React.createElement(Harness, { handleRef }));
  act(() => handleRef.current!.attach(scroll.element));
  act(() => scroll.setScrollTop(120));

  const writer = vi.fn();
  act(() => handleRef.current!.viewport.registerScrollWriter(writer));
  act(() => handleRef.current!.viewport.scrollToBottom());

  expect(writer).toHaveBeenCalledOnce();
  expect(scroll.scrollTop).toBe(120); // no direct write happened
});
