import { test, expect } from 'vitest';

import { estimateReleaseVelocity, MAX_THROW_SPEED, throwStep } from './physics';

test('a held release and gentle placement stay still, while a flick has bounded velocity', () => {
  const trail = [
    { x: 0, y: 0, t: 0 },
    { x: 300, y: -100, t: 100 },
  ];
  expect(estimateReleaseVelocity(trail, 300)).toBeNull();
  expect(
    estimateReleaseVelocity(
      [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 0, t: 100 },
      ],
      100,
    ),
  ).toBeNull();
  const velocity = estimateReleaseVelocity(trail, 100)!;
  expect(velocity.vx).toBeGreaterThan(0);
  expect(velocity.vy).toBeLessThan(0);
  expect(Math.hypot(velocity.vx, velocity.vy)).toBeLessThanOrEqual(MAX_THROW_SPEED);
});

test('throws on negative-origin screens bounce and eventually settle inside the work area', () => {
  const bounds = { minX: -1920, minY: 24, maxX: -192, maxY: 888 };
  let step = { x: -220, y: 100, vx: 1500, vy: -1000, bounced: false, atRest: false };
  let bounced = false;
  for (let i = 0; i < 4000 && !step.atRest; i++) {
    step = throwStep(step, 0.016, bounds);
    bounced ||= step.bounced;
    expect(step.x).toBeGreaterThanOrEqual(bounds.minX);
    expect(step.x).toBeLessThanOrEqual(bounds.maxX);
    expect(step.y).toBeGreaterThanOrEqual(bounds.minY);
    expect(step.y).toBeLessThanOrEqual(bounds.maxY);
  }
  expect(bounced).toBe(true);
  expect(step.atRest).toBe(true);
});

test('a suspended timer cannot teleport the pet through a screen edge', () => {
  const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 800 };
  const start = { x: 500, y: 100, vx: 100, vy: 100 };
  expect(throwStep(start, 60, bounds)).toEqual(throwStep(start, 0.05, bounds));
});
