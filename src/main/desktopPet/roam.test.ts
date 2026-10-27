import { test, expect, vi } from 'vitest';

import { DesktopPetRoam } from './roam';

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
