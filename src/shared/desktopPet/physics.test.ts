import { test, expect } from 'vitest';

import { estimateReleaseVelocity, impactStrength, MAX_THROW_SPEED, throwStep } from './physics';

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

test('a plush drop settles in a couple of small bounces', () => {
  const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 800 };
  const dropFrom = (drop: number) => {
    let state = { x: 500, y: bounds.maxY - drop, vx: 0, vy: 0 };
    let bounces = 0;
    let seconds = 0;
    for (let i = 0; i < 3000; i++) {
      const previous = state;
      const next = throwStep(state, 1 / 60, bounds);
      if (next.vy < 0 && previous.vy > 0) bounces++;
      state = next;
      seconds += 1 / 60;
      if (next.atRest) break;
    }
    return { bounces, seconds };
  };

  for (const drop of [100, 200]) {
    const { bounces, seconds } = dropFrom(drop);
    expect(bounces).toBeGreaterThanOrEqual(1);
    expect(bounces).toBeLessThanOrEqual(3);
    expect(seconds).toBeLessThan(1.5);
  }
});

test('impact feedback only fires for meaningful collisions', () => {
  expect(impactStrength(Number.NaN)).toBe(0);
  expect(impactStrength(0)).toBe(0);
  expect(impactStrength(320)).toBe(0);
  expect(impactStrength(321)).toBeGreaterThan(0);
  expect(impactStrength(513)).toBeGreaterThan(0.2);
  expect(impactStrength(513)).toBeLessThan(0.3);
  expect(impactStrength(2400)).toBe(1);
  expect(impactStrength(3600)).toBe(1);
});
