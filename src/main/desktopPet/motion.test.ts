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
import { DesktopPetEffectKind } from '../../shared/desktopPet/constants';
import { DESKTOP_PET_CANVAS_TOP, DESKTOP_PET_WINDOW_HEIGHT } from '../../shared/desktopPet/layout';

let position = { x: 400, y: 300 };
const ignore = vi.fn();
const settled = vi.fn();
const effect = vi.fn();
const window = {
  getPosition: () => [position.x, position.y],
  getBounds: () => ({ ...position, width: 192, height: DESKTOP_PET_WINDOW_HEIGHT }),
  setPosition: vi.fn((x: number, y: number) => {
    position = { x, y };
  }),
  isDestroyed: () => false,
  setIgnoreMouseEvents: ignore,
} as unknown as BrowserWindow;
let motion: DesktopPetMotion;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.clearAllMocks();
  desktop.cursor = { x: 496, y: 396 + DESKTOP_PET_CANVAS_TOP };
  desktop.area = { x: 0, y: 24, width: 1440, height: 876 };
  position = { x: 400, y: 300 };
  motion = new DesktopPetMotion(window, settled, effect);
});
afterEach(() => {
  motion.dispose();
  vi.useRealTimers();
});

test('a stationary drag does not repeatedly rewrite the native window position', () => {
  motion.begin();
  vi.advanceTimersByTime(100);
  expect(window.setPosition).not.toHaveBeenCalled();
  expect(motion.end()).toBe(true);
  expect(window.setPosition).not.toHaveBeenCalled();
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
  desktop.cursor.x += 3;
  vi.advanceTimersByTime(32);
  expect(position).toEqual({ x: 400, y: 300 });
  expect(effect).not.toHaveBeenCalled();
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
  expect(effect).toHaveBeenLastCalledWith({ kind: DesktopPetEffectKind.Drag, active: false });
});

test('native drag and meaningful collisions emit bounded visual effects, without per-tick messages', () => {
  motion.begin();
  desktop.cursor.y += 6;
  vi.advanceTimersByTime(16);
  expect(effect).toHaveBeenLastCalledWith({ kind: DesktopPetEffectKind.Drag, active: true });
  for (let i = 0; i < 5; i++) {
    desktop.cursor.y += 40;
    vi.advanceTimersByTime(32);
  }
  expect(effect).toHaveBeenCalledOnce();
  motion.end();
  expect(effect).toHaveBeenLastCalledWith({ kind: DesktopPetEffectKind.Drag, active: false });
  vi.advanceTimersByTime(1000);
  const impacts = effect.mock.calls
    .map(([value]) => value)
    .filter(value => value.kind === DesktopPetEffectKind.Impact);
  expect(impacts.length).toBeGreaterThan(0);
  expect(impacts.every(value => value.strength > 0 && value.strength <= 1)).toBe(true);
  motion.setReducedMotion(true);
  effect.mockClear();
  vi.advanceTimersByTime(1000);
  expect(effect).not.toHaveBeenCalled();
});

test('a drag returning to its starting point remains a drag rather than a click', () => {
  const start = { ...desktop.cursor };
  motion.begin();
  desktop.cursor.x += 100;
  vi.advanceTimersByTime(32);
  desktop.cursor = start;
  vi.advanceTimersByTime(32);
  expect(motion.end()).toBe(false);
});

test('a cancelled flick stays placed without throwing or click feedback', () => {
  motion.begin();
  desktop.cursor.x += 100;
  vi.advanceTimersByTime(32);
  expect(motion.end(true)).toBe(false);
  const placed = { ...position };
  vi.advanceTimersByTime(1000);
  expect(position).toEqual(placed);
  expect(settled).toHaveBeenCalledOnce();
});

test('sliding along the ground does not repeatedly trigger landing impulses', () => {
  position = { x: 400, y: 708 - DESKTOP_PET_CANVAS_TOP };
  desktop.cursor = { x: 496, y: 804 - DESKTOP_PET_CANVAS_TOP };
  motion.begin();
  for (let i = 0; i < 5; i++) {
    desktop.cursor.x += 20;
    vi.advanceTimersByTime(32);
  }
  motion.end();
  effect.mockClear();
  const released = position.x;
  vi.advanceTimersByTime(300);
  expect(position.x).toBeGreaterThan(released);
  expect(position.y).toBe(708 - DESKTOP_PET_CANVAS_TOP);
  expect(effect).not.toHaveBeenCalled();
});

test('quiet mode stops native polling and motion until explicitly resumed', () => {
  motion.begin();
  desktop.cursor.x += 100;
  vi.advanceTimersByTime(32);
  motion.pause();
  const paused = { ...position };
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(1000);
  expect(position).toEqual(paused);
  motion.resume();
  expect(vi.getTimerCount()).toBe(1);
  expect(position).toEqual(paused);
});

test('an explicit action rests a walking pet and publishes the stopped pose before playback', () => {
  motion.dispose();
  const pose = vi.fn();
  motion = new DesktopPetMotion(window, settled, effect, pose);
  motion.setAllowRoam(true);
  vi.advanceTimersByTime(100);
  expect(pose).toHaveBeenLastCalledWith(expect.objectContaining({ walking: true }));
  motion.rest();
  expect(pose).toHaveBeenLastCalledWith(expect.objectContaining({ walking: false }));
  const stopped = { ...position };
  vi.advanceTimersByTime(15_000);
  expect(position).toEqual(stopped);
  motion.setAllowRoam(false);
  expect(pose).toHaveBeenLastCalledWith(expect.objectContaining({ walking: false }));
});
