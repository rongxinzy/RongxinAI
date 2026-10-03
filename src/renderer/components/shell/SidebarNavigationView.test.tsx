// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { SidebarNavigationView } from './SidebarNavigationView';

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseProps = () => ({
  isChat: false,
  workLabel: 'Work',
  chatLabel: 'Chat',
  onModeChange: vi.fn(),
  newConversation: {
    id: 'conversation' as const,
    icon: 'conversation' as const,
    label: 'New task',
    active: false,
    onClick: vi.fn(),
  },
  entries: [],
});

function stubAnimationFrame() {
  const queue = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queue.delete(id);
  });
  return {
    flush() {
      const callbacks = Array.from(queue.values());
      queue.clear();
      callbacks.forEach(callback => callback(0));
    },
    get pending() {
      return queue.size;
    },
  };
}

test('flips the thumb optimistically and defers the mode change to the next frame', () => {
  const raf = stubAnimationFrame();
  const props = baseProps();
  const view = render(createElement(SidebarNavigationView, props));
  const toggle = screen.getByRole('switch', { name: 'Work / Chat' });
  expect(toggle).toHaveAttribute('aria-checked', 'false');

  fireEvent.click(toggle);

  expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(props.onModeChange).not.toHaveBeenCalled();
  expect(raf.pending).toBe(1);

  raf.flush();
  expect(props.onModeChange).toHaveBeenCalledExactlyOnceWith(true);

  view.rerender(createElement(SidebarNavigationView, { ...props, isChat: true }));
  expect(toggle).toHaveAttribute('aria-checked', 'true');
});

test('a rapid second toggle cancels the stale deferred change', () => {
  const raf = stubAnimationFrame();
  const props = baseProps();
  render(createElement(SidebarNavigationView, props));
  const toggle = screen.getByRole('switch', { name: 'Work / Chat' });

  fireEvent.click(toggle);
  fireEvent.click(toggle);

  expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(raf.pending).toBe(1);
  raf.flush();
  expect(props.onModeChange).toHaveBeenCalledExactlyOnceWith(false);
});
