import { test, expect } from 'vitest';

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
