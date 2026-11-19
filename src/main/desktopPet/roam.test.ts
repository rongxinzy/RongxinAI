import { afterEach, test, expect, vi } from 'vitest';

import { XIAOYUAN_WALK_SECONDS } from '../../shared/desktopPet/motionCatalog';

import { DesktopPetRoam } from './roam';

afterEach(() => vi.restoreAllMocks());

test('roaming waits then walks horizontally within bounds', () => {
  const roam = new DesktopPetRoam();
  const bounds = { minX: 0, minY: 100, maxX: 800, maxY: 700 };
  roam.reset(0);
  expect(roam.tick(1000, { x: 400, y: 600 }, bounds, true)).toBeNull();
  let step = roam.tick(50_000, { x: 400, y: 600 }, bounds, true);
  expect(step).not.toBeNull();
  expect(step!.y).toBe(600);
  expect(Math.abs(step!.x - 400)).toBeGreaterThan(0);
  while (step?.walking) {
    step = roam.tick(50_016, { x: step!.x, y: step!.y }, bounds, true);
  }
  expect(roam.isWalking()).toBe(false);
});

test('roaming stops when disabled', () => {
  const roam = new DesktopPetRoam();
  roam.reset(0);
  expect(
    roam.tick(30_000, { x: 100, y: 200 }, { minX: 0, minY: 0, maxX: 500, maxY: 500 }, false),
  ).toBeNull();
  expect(roam.isWalking()).toBe(false);
});

test('roaming distance depends on elapsed time rather than tick frequency or rounding', () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const bounds = { minX: 0, minY: 0, maxX: 800, maxY: 700 };
  const walk = (interval: number) => {
    const roam = new DesktopPetRoam();
    roam.reset(0);
    let position = { x: 400, y: 600 };
    let step = roam.tick(29_000, position, bounds, true, 0);
    const frames = Math.round(1000 / interval);
    for (let frame = 1; frame <= frames; frame++) {
      if (step) position = { x: step.x, y: step.y };
      step = roam.tick(29_000 + frame * interval, position, bounds, true, interval);
    }
    return step!.x;
  };
  expect(walk(1000 / 60)).toBeCloseTo(walk(1000 / 30), 8);
  expect(walk(1000 / 60)).toBeCloseTo(358, 8);
  random.mockRestore();
});

test('the synchronized walk holds through lead-in and moves only when decoded frames advance', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const roam = new DesktopPetRoam();
  const bounds = { minX: 0, minY: 0, maxX: 800, maxY: 700 };
  const position = { x: 400, y: 600 };
  roam.setMediaDriven(true, 0);
  const start = roam.tick(29_000, position, bounds, true)!;
  expect(start).toEqual({ ...position, facing: -1, walking: true, walkId: 1 });
  expect(roam.tick(29_480, position, bounds, true, 480)).toEqual(start);
  roam.observeMediaFrame({ walkId: 1, mediaTime: 0.12 }, 29_500);
  expect(roam.tick(29_500, position, bounds, true)).toEqual(start);

  roam.observeMediaFrame({ walkId: 1, mediaTime: 1.935 }, 29_960);
  const mid = roam.tick(29_960, position, bounds, true)!;
  expect(mid.x).toBeCloseTo(334);
  expect(roam.tick(30_240, { x: mid.x, y: mid.y }, bounds, true, 280)).toEqual(mid);

  roam.observeMediaFrame({ walkId: 1, mediaTime: 3.75 }, 30_460);
  const tail = roam.tick(30_460, position, bounds, true)!;
  expect(tail).toEqual({ x: 268, y: 600, facing: -1, walking: true, walkId: 1 });
  roam.observeMediaFrame({ walkId: 1, mediaTime: XIAOYUAN_WALK_SECONDS }, 30_700);
  expect(roam.tick(30_700, position, bounds, true)).toEqual({
    x: 268,
    y: 600,
    facing: -1,
    walking: false,
  });
  expect(roam.isWalking()).toBe(false);
});

test('Xiaoyuan takes a full walk away from a close edge', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const roam = new DesktopPetRoam();
  const bounds = { minX: 0, minY: 0, maxX: 800, maxY: 700 };
  const position = { x: 785, y: 600 };
  roam.setMediaDriven(true, 0);
  const walk = roam.tick(18_000, position, bounds, true)!;
  expect(walk.facing).toBe(-1);
  roam.observeMediaFrame({ walkId: walk.walkId, mediaTime: 1.935 }, 19_935);
  expect(roam.tick(19_935, position, bounds, true)?.x).toBeCloseTo(749);
});

test('an unavailable or stalled clip cancels without consuming late, stale, or repeated frames', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const roam = new DesktopPetRoam();
  const bounds = { minX: 0, minY: 0, maxX: 800, maxY: 700 };
  const position = { x: 400, y: 600 };
  roam.setMediaDriven(true, 0);
  const start = roam.tick(29_000, position, bounds, true)!;
  roam.observeMediaFrame({ walkId: start.walkId, mediaTime: NaN }, 31_490);
  roam.observeMediaFrame({ walkId: start.walkId, mediaTime: 1 }, 31_500);
  expect(roam.tick(31_500, position, bounds, true)).toBeNull();
  expect(roam.isWalking()).toBe(false);

  const newStart = roam.tick(60_500, position, bounds, true)!;
  expect(newStart.walkId).not.toEqual(start.walkId);
  roam.observeMediaFrame({ walkId: start.walkId, mediaTime: 4 }, 60_510);
  expect(roam.tick(60_550, position, bounds, true)).toEqual(newStart);
  roam.observeMediaFrame({ walkId: newStart.walkId, mediaTime: 0.6 }, 60_600);
  expect(roam.tick(60_600, position, bounds, true)?.x).toBeLessThan(position.x);
  roam.observeMediaFrame({ walkId: newStart.walkId, mediaTime: 0.6 }, 61_340);
  roam.observeMediaFrame({ walkId: newStart.walkId, mediaTime: 0.5 }, 61_345);
  expect(roam.tick(61_350, position, bounds, true)).toBeNull();
  expect(roam.isWalking()).toBe(false);
});
