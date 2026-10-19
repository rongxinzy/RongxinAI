import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const desktop = vi.hoisted(() => ({
  cursor: { x: 496, y: 396 },
  area: { x: 0, y: 24, width: 1440, height: 876 },
}));
vi.mock('electron', () => ({
  screen: {
    getCursorScreenPoint: () => ({ ...desktop.cursor }),
    getDisplayNearestPoint: () => ({ workArea: desktop.area }),
    getDisplayMatching: () => ({ workArea: desktop.area }),
  },
}));

import { DesktopPetMotion } from './motion';

let position = { x: 400, y: 300 };
const ignore = vi.fn();
const settled = vi.fn();
const window = {
  getPosition: () => [position.x, position.y],
  getBounds: () => ({ ...position, width: 192, height: 192 }),
  setPosition: (x: number, y: number) => {
    position = { x, y };
  },
  isDestroyed: () => false,
  setIgnoreMouseEvents: ignore,
} as unknown as BrowserWindow;
let motion: DesktopPetMotion;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.clearAllMocks();
  desktop.cursor = { x: 496, y: 396 };
  desktop.area = { x: 0, y: 24, width: 1440, height: 876 };
  position = { x: 400, y: 300 };
  motion = new DesktopPetMotion(window, settled);
});
afterEach(() => {
  motion.dispose();
  vi.useRealTimers();
});

test('opaque body receives clicks while transparent pixels pass through, using a copied mask', () => {
  const alpha = new Uint8Array(192 * 192);
  alpha[96 * 192 + 96] = 255;
  motion.setMask(alpha);
  alpha.fill(0);
  vi.advanceTimersByTime(80);
  expect(ignore).toHaveBeenLastCalledWith(false);
  desktop.cursor = { x: 401, y: 301 };
  vi.advanceTimersByTime(80);
  expect(ignore).toHaveBeenLastCalledWith(true);
});

test('dragging then holding before release places the companion without residual velocity', () => {
  motion.begin();
  desktop.cursor.x += 100;
  vi.advanceTimersByTime(32);
  expect(position).toEqual({ x: 500, y: 300 });
  vi.advanceTimersByTime(200);
  expect(motion.end()).toBe(false);
  const placed = { ...position };
  vi.advanceTimersByTime(1000);
  expect(position).toEqual(placed);
  expect(settled).toHaveBeenCalledOnce();
});

test('a flick moves after release, and reduced motion stops it immediately', () => {
  motion.begin();
  for (let i = 0; i < 5; i++) {
    desktop.cursor.x += 50;
    vi.advanceTimersByTime(32);
  }
  const releaseX = position.x;
  motion.end();
  vi.advanceTimersByTime(64);
  expect(position.x).toBeGreaterThan(releaseX);
  motion.setReducedMotion(true);
  const stopped = { ...position };
  vi.advanceTimersByTime(1000);
  expect(position).toEqual(stopped);
  expect(settled).toHaveBeenCalledOnce();
});

test('a click stays in place and disposal cancels the native polling timer', () => {
  motion.begin();
  expect(motion.end()).toBe(true);
  expect(position).toEqual({ x: 400, y: 300 });
  motion.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

test('a removed display clamps an ongoing drag to the remaining work area', () => {
  motion.begin();
  desktop.area = { x: -800, y: 24, width: 800, height: 600 };
  motion.ensureVisible();
  expect(position).toEqual({ x: -192, y: 300 });
  desktop.cursor = { x: 1000, y: 1000 };
  vi.advanceTimersByTime(500);
  expect(position).toEqual({ x: -192, y: 300 });
});
