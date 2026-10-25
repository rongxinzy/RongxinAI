import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { visibleWindowSurfaces } from './geometry';
import { PetOrientation } from './constants';
import { surfaceFoot, surfaceWindowPosition } from './placement';
import { WindowSurfaceWalker } from './walker';
import type { NativeWindowFrame, SurfaceDisplay, SurfacePoint } from './types';

const display: SurfaceDisplay = {
  id: 'main',
  physical: { x: 0, y: 0, width: 1920, height: 1080 },
  dip: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};
const owner: NativeWindowFrame = {
  id: 'abc',
  rect: { x: 300, y: 400, width: 800, height: 500 },
  attachable: true,
};
let walker: WindowSurfaceWalker;
function scene(windows: NativeWindowFrame[], at: number) {
  walker.setSnapshot(
    {
      revision: 1,
      sequence: 1,
      capturedAt: at,
      timing: { queueMs: 0, runMs: 0 },
      fullscreenDisplays: [],
      surfaces: visibleWindowSurfaces(windows, [display]),
    },
    at,
  );
}
function tick(at: number, position: SurfacePoint, allow = true) {
  return walker.tick(at, position, display.id, display.workArea, allow);
}
beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  walker = new WindowSurfaceWalker();
  walker.reset(0);
});
afterEach(() => vi.restoreAllMocks());

test('a resting companion follows its owner even while a task prevents autonomous movement', () => {
  scene([owner], 0);
  const first = tick(0, surfaceWindowPosition({ x: 600, y: 400 }, PetOrientation.Upright))!;
  expect(first.walking).toBe(false);
  expect(walker.moving).toBe(false);
  scene([{ ...owner, rect: { ...owner.rect, x: 400, y: 460 } }], 100);
  const moved = tick(100, first, false)!;
  expect(moved.x - first.x).toBe(100);
  expect(moved.y - first.y).toBe(60);
  expect(moved.walking).toBe(false);
});

test('wall attachment preserves its contact and climbing has time-based progress', () => {
  scene([owner], 0);
  const initial = surfaceWindowPosition({ x: 300, y: 650 }, PetOrientation.Upright);
  let pose = tick(0, initial)!;
  expect(pose.orientation).toBe(PetOrientation.Left);
  expect(surfaceFoot(pose, pose.orientation)).toEqual({ x: 300, y: 650 });
  scene([owner], 8001);
  pose = tick(8001, pose)!;
  const before = surfaceFoot(pose, pose.orientation);
  pose = tick(8051, pose)!;
  expect(pose.walking).toBe(true);
  expect(surfaceFoot(pose, pose.orientation).y).toBeCloseTo(before.y - 2.1);
  expect(pose.facing).toBe(1);
  expect(walker.moving).toBe(true);
});

test('window disappearance falls onto a lower exposed ledge instead of retaining a phantom owner', () => {
  scene([owner], 0);
  let pose = tick(0, surfaceWindowPosition({ x: 600, y: 400 }, PetOrientation.Upright))!;
  const lower = { ...owner, id: 'def', rect: { ...owner.rect, y: 650, height: 250 } };
  scene([lower], 50);
  let landed = false;
  for (let at = 50; at <= 1000; at += 50) {
    pose = tick(at, pose)!;
    if (pose.landed) {
      landed = true;
      break;
    }
  }
  expect(landed).toBe(true);
  expect(surfaceFoot(pose, pose.orientation)).toEqual({ x: 600, y: 650 });
  scene([{ ...lower, rect: { ...lower.rect, y: 700 } }], 1100);
  expect(surfaceFoot(tick(1100, pose, false)!, PetOrientation.Upright).y).toBe(700);
});

test('expired geometry releases support and settles inside the work area', () => {
  scene([owner], 0);
  let pose = tick(0, surfaceWindowPosition({ x: 600, y: 400 }, PetOrientation.Upright))!;
  for (let at = 2000; at < 4500; at += 50) pose = tick(at, pose) ?? pose;
  expect(pose.y).toBe(1040 - 232);
  expect(walker.active).toBe(false);
  expect(pose.orientation).toBe(PetOrientation.Upright);
});

test('a moving target aborts an in-flight hop rather than teleporting to it', () => {
  const position = surfaceWindowPosition({ x: 600, y: 450 }, PetOrientation.Upright);
  scene([owner], 8001);
  const airborne = tick(8001, position)!;
  expect(airborne.hopping).toBe(true);
  scene([{ ...owner, rect: { ...owner.rect, x: 600 } }], 8050);
  const recovered = tick(8050, airborne)!;
  expect(recovered.hopping).not.toBe(true);
  expect(Math.abs(recovered.x - airborne.x)).toBeLessThan(1);
  expect(recovered.y).toBeGreaterThanOrEqual(airborne.y);
  expect(recovered.landed).not.toBe(true);
});

test('an owner at the display boundary cannot pull the companion off screen', () => {
  scene([{ ...owner, rect: { ...owner.rect, y: 80 } }], 0);
  expect(tick(0, { x: 504, y: 0 })).toBeNull();
});

test('explicit reset abandons support and does not resume an old hop or fall', () => {
  scene([owner], 0);
  const position = surfaceWindowPosition({ x: 600, y: 400 }, PetOrientation.Upright);
  tick(0, position);
  walker.reset(50);
  expect(walker.active).toBe(false);
  expect(tick(100, position, false)).toBeNull();
});
