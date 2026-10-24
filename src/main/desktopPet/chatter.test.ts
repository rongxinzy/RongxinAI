import { test, expect, vi } from 'vitest';

import { DesktopPetPlayableAction } from '../../shared/desktopPet/constants';
import {
  DESKTOP_PET_ACTION_CHATTER_KEYS,
  DesktopPetChatter,
  DESKTOP_PET_CHATTER_KEYS,
} from './chatter';

test('chatter pool is a fixed local key list', () => {
  expect(DESKTOP_PET_CHATTER_KEYS.length).toBeGreaterThanOrEqual(8);
  for (const key of DESKTOP_PET_CHATTER_KEYS) {
    expect(key.startsWith('desktopPet_chatter_')).toBe(true);
  }
});

test('action chatter shows immediately and survives non-idle ticks until its window ends', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const chatter = new DesktopPetChatter();
  chatter.reset(0);
  chatter.showAction(DesktopPetPlayableAction.Peek, 100);
  expect(chatter.activeKey()).toBe(DESKTOP_PET_ACTION_CHATTER_KEYS.peek);
  expect(chatter.tick(3_599, false)).toBe(false);
  expect(chatter.activeKey()).toBe(DESKTOP_PET_ACTION_CHATTER_KEYS.peek);
  expect(chatter.tick(3_600, false)).toBe(true);
  expect(chatter.activeKey()).toBeNull();
  expect(chatter.tick(25_599, true)).toBe(false);
  expect(chatter.tick(25_600, true)).toBe(true);
  expect(DESKTOP_PET_CHATTER_KEYS).toContain(chatter.activeKey());
});

test('action chatter expires during idle and clears when explicitly disabled', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const chatter = new DesktopPetChatter();
  chatter.reset(0);
  chatter.showAction(DesktopPetPlayableAction.Happy, 1_000);
  expect(chatter.activeKey()).toBe(DESKTOP_PET_ACTION_CHATTER_KEYS.happy);
  expect(chatter.tick(4_500, true)).toBe(true);
  expect(chatter.activeKey()).toBeNull();
  chatter.showAction(DesktopPetPlayableAction.Nod, 5_000);
  chatter.clear();
  expect(chatter.activeKey()).toBeNull();
  expect(chatter.tick(8_000, true)).toBe(false);
  expect(chatter.tick(27_000, true)).toBe(true);
});

test('the idle pool does not contain action keys', () => {
  expect(DESKTOP_PET_CHATTER_KEYS).not.toEqual(
    expect.arrayContaining(Object.values(DESKTOP_PET_ACTION_CHATTER_KEYS)),
  );
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
