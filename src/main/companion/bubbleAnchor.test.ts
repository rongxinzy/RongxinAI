import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, expect, test, vi } from 'vitest';
import { anchorCompanionBubble } from './bubbleAnchor';

const screen = vi.hoisted(() => ({
  getCursorScreenPoint: () => ({ x: 700, y: 700 }),
  getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 1000 } }),
  on: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock('electron', () => ({ screen }));

class FakeWindow extends EventEmitter {
  bounds = { x: 700, y: 700, width: 192, height: 232 };
  focus = vi.fn();
  isDestroyed = () => false;
  isVisible = () => true;
  getBounds = () => this.bounds;
  setBounds = vi.fn((bounds: typeof this.bounds) => {
    this.bounds = bounds;
  });
  hide = () => this.emit('hide');
}
const native = (window: FakeWindow) => window as unknown as BrowserWindow;

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

test('explicit first-show activation follows real movement without a native show event', () => {
  vi.useFakeTimers();
  const bubble = new FakeWindow();
  const pet = new FakeWindow();
  const visibility = vi.fn();
  const anchor = anchorCompanionBubble(
    native(bubble),
    { getPetWindow: () => native(pet), onBubbleVisibility: visibility },
    vi.fn(),
  );
  anchor.activate();
  expect(pet.listenerCount('move')).toBe(1);
  pet.bounds = { ...pet.bounds, x: 600, y: 600 };
  pet.emit('move');
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(16);
  expect(bubble.bounds).toEqual({ x: 456, y: 232, width: 480, height: 400 });
  expect(bubble.focus).not.toHaveBeenCalled();
  expect(visibility.mock.calls).toEqual([[true]]);
  bubble.emit('closed');
  expect(pet.listenerCount('move')).toBe(0);
});

test('activation deduplicates bindings, rebinds a newly available pet and cancels on hide', () => {
  vi.useFakeTimers();
  const bubble = new FakeWindow();
  let pet: FakeWindow | null = null;
  const visibility = vi.fn();
  const anchor = anchorCompanionBubble(
    native(bubble),
    { getPetWindow: () => pet && native(pet), onBubbleVisibility: visibility },
    vi.fn(),
  );
  anchor.activate();
  pet = new FakeWindow();
  anchor.activate();
  anchor.activate();
  bubble.emit('show');
  expect(pet.listenerCount('move')).toBe(1);
  pet.emit('move');
  pet.emit('resize');
  expect(vi.getTimerCount()).toBe(1);
  anchor.deactivate();
  bubble.emit('hide');
  expect(vi.getTimerCount()).toBe(0);
  expect(pet.listenerCount('move')).toBe(0);
  expect(pet.listenerCount('hide')).toBe(0);
  anchor.activate();
  expect(pet.listenerCount('move')).toBe(1);
  bubble.emit('closed');
  expect(pet.listenerCount('move')).toBe(0);
  expect(visibility.mock.calls.at(-1)).toEqual([false]);
});

test('unchanged pet bounds do not repeatedly reposition the transparent bubble', () => {
  vi.useFakeTimers();
  const bubble = new FakeWindow();
  const pet = new FakeWindow();
  const anchor = anchorCompanionBubble(
    native(bubble),
    { getPetWindow: () => native(pet) },
    vi.fn(),
  );
  anchor.activate();
  bubble.setBounds.mockClear();
  pet.emit('move');
  vi.advanceTimersByTime(16);
  expect(bubble.setBounds).not.toHaveBeenCalled();
  bubble.emit('closed');
});
