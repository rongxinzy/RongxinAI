import { test, expect, vi } from 'vitest';

import { DesktopPetChatter, DESKTOP_PET_CHATTER_KEYS } from './chatter';

test('chatter pool is a fixed local key list', () => {
  expect(DESKTOP_PET_CHATTER_KEYS.length).toBeGreaterThanOrEqual(8);
  for (const key of DESKTOP_PET_CHATTER_KEYS) {
    expect(key.startsWith('desktopPet_chatter_')).toBe(true);
  }
});

test('chatter stays quiet until the rest interval elapses', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const chatter = new DesktopPetChatter();
  chatter.reset(0);
  expect(chatter.tick(1_000, true)).toBe(false);
  expect(chatter.activeKey()).toBeNull();
  expect(chatter.tick(22_000, true)).toBe(true);
  expect(chatter.activeKey()).toBe('desktopPet_chatter_1');
});

test('chatter clears after the show window and when disallowed', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const chatter = new DesktopPetChatter();
  chatter.reset(0);
  expect(chatter.tick(22_000, true)).toBe(true);
  expect(chatter.activeKey()).not.toBeNull();
  expect(chatter.tick(22_000 + 3_500, true)).toBe(true);
  expect(chatter.activeKey()).toBeNull();
  expect(chatter.tick(80_000, true)).toBe(true);
  expect(chatter.activeKey()).not.toBeNull();
  expect(chatter.tick(80_000, false)).toBe(true);
  expect(chatter.activeKey()).toBeNull();
  expect(chatter.tick(200_000, false)).toBe(false);
});
