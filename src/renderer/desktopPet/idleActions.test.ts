import { test, expect } from 'vitest';

import { DesktopPetIdleActions } from './idleActions';

test('idle actions stay quiet until scheduled and return to neutral', () => {
  const idle = new DesktopPetIdleActions();
  idle.sample(0, true);
  const active = idle.sample(450, true);
  expect(Math.abs(active.rotate) + Math.abs(active.offsetY) + active.greetingBoost).toBeGreaterThan(
    0,
  );
  expect(idle.sample(2_000, true).greetingBoost).toBe(0);
});
