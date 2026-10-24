import { expect, test } from 'vitest';
import {
  DesktopPetMotion,
  DESKTOP_PET_MOTIONS,
} from '../../../src/shared/desktopPet/motionCatalog';
import { sampleOwlMotion } from './owl-motion.mjs';

test('authored loop joints meet at the seam without positional or angular jumps', () => {
  for (const clip of DESKTOP_PET_MOTIONS.filter(clip => clip.loop)) {
    const start = sampleOwlMotion(clip.id, 0, clip.seconds, DesktopPetMotion);
    const end = sampleOwlMotion(clip.id, clip.seconds, clip.seconds, DesktopPetMotion);
    for (const key of Object.keys(start)) {
      if (typeof start[key] === 'number')
        expect(Math.abs(start[key] - end[key]), `${clip.id}:${key}`).toBeLessThan(1e-10);
      else expect(end[key], `${clip.id}:${key}`).toBe(start[key]);
    }
  }
});

test('doze ends in the wake opening pose and wake returns to neutral', () => {
  const doze = DESKTOP_PET_MOTIONS.find(clip => clip.id === DesktopPetMotion.Doze)!;
  const wake = DESKTOP_PET_MOTIONS.find(clip => clip.id === DesktopPetMotion.Wake)!;
  const end = sampleOwlMotion(doze.id, doze.seconds, doze.seconds, DesktopPetMotion);
  const start = sampleOwlMotion(wake.id, 0, wake.seconds, DesktopPetMotion);
  for (const key of Object.keys(start)) {
    if (typeof start[key] === 'number')
      expect(Math.abs(start[key] - end[key]), key).toBeLessThan(1e-10);
    else expect(end[key], key).toBe(start[key]);
  }
  const idle = DESKTOP_PET_MOTIONS.find(clip => clip.id === DesktopPetMotion.Idle)!;
  const neutral = sampleOwlMotion(idle.id, 0, idle.seconds, DesktopPetMotion);
  const awake = sampleOwlMotion(wake.id, wake.seconds, wake.seconds, DesktopPetMotion);
  for (const key of Object.keys(neutral)) {
    if (typeof neutral[key] === 'number')
      expect(Math.abs(neutral[key] - awake[key]), key).toBeLessThan(1e-10);
    else expect(awake[key], key).toBe(neutral[key]);
  }
});
