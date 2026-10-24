import { test, expect } from 'vitest';

import { DesktopPetPlayableAction } from '../../shared/desktopPet/constants';
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

test('play starts an action immediately and settles back to neutral', () => {
  const idle = new DesktopPetIdleActions();
  idle.play(DesktopPetPlayableAction.Nod, 0);
  const active = idle.sample(450, true);
  expect(active.offsetY).toBeLessThan(0);
  expect(idle.sample(950, true)).toEqual({ rotate: 0, offsetX: 0, offsetY: 0, greetingBoost: 0 });
});

test('played actions stay visible while idle motion is suppressed', () => {
  const idle = new DesktopPetIdleActions();
  idle.play(DesktopPetPlayableAction.Happy, 0);
  const active = idle.sample(450, false);
  expect(active.offsetY).toBeLessThan(0);
  expect(active.greetingBoost).toBeGreaterThan(0);
  expect(idle.sample(950, false)).toEqual({ rotate: 0, offsetX: 0, offsetY: 0, greetingBoost: 0 });
});
