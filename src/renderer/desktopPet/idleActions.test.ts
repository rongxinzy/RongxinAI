import { test, expect, vi } from 'vitest';
import { DesktopPetPlayableAction } from '../../shared/desktopPet/constants';
import { DesktopPetIdleActions } from './idleActions';

test('idle playback starts after quiet time and respects suppression', () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  try {
    const idle = new DesktopPetIdleActions();
    expect(idle.sample(0, true).kind).toBeNull();
    expect(idle.sample(8999, true).kind).toBeNull();
    expect(idle.sample(9000, true).kind).toBe(DesktopPetPlayableAction.Peek);
    expect(idle.sample(10_700, true).offsetX).toBe(-7);
    expect(idle.sample(10_701, false).kind).toBeNull();
    expect(idle.sample(60_000, true).kind).toBeNull();
  } finally {
    random.mockRestore();
  }
});

test('explicit playback starts immediately, follows facing and settles back to neutral', () => {
  const idle = new DesktopPetIdleActions();
  idle.setFacing(-1);
  idle.play(DesktopPetPlayableAction.Peek, 100);
  expect(idle.sample(1800, true).offsetX).toBe(7);
  expect(idle.sample(8300, true).influence).toBe(0);
  idle.play(DesktopPetPlayableAction.Happy, 8400);
  expect(idle.sample(9400, false).kind).toBeNull();
});
