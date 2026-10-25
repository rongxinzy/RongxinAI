import { expect, test } from 'vitest';
import { DesktopPetBuiltinId } from '../../../src/shared/desktopPet/catalog';
import {
  DESKTOP_PET_MOTIONS,
  DesktopPetMotion,
} from '../../../src/shared/desktopPet/motionCatalog';
import { COMPANION_RIGS } from './companion-rigs.mjs';
import { sampleCompanionMotion } from './companion-motion.mjs';

const rigs = Object.values(COMPANION_RIGS);
const sample = (rig: (typeof rigs)[number], id: DesktopPetMotion, time: number, duration: number) =>
  sampleCompanionMotion(id, time, duration, DesktopPetMotion, rig, DesktopPetBuiltinId);

function samePose(
  left: ReturnType<typeof sample>,
  right: ReturnType<typeof sample>,
  label: string,
) {
  for (const key of Object.keys(left) as (keyof typeof left)[]) {
    if (typeof left[key] === 'number' && typeof right[key] === 'number')
      expect(Math.abs(Number(left[key]) - Number(right[key])), `${label}:${key}`).toBeLessThan(
        1e-10,
      );
    else expect(right[key], `${label}:${key}`).toBe(left[key]);
  }
}

test('all six companions have continuous authored loop joints at the seam', () => {
  expect(rigs).toHaveLength(6);
  for (const rig of rigs)
    for (const clip of DESKTOP_PET_MOTIONS.filter(clip => clip.loop))
      samePose(
        sample(rig, clip.id, 0, clip.seconds),
        sample(rig, clip.id, clip.seconds, clip.seconds),
        `${rig.id}:${clip.id}`,
      );
});

test('sleep and wake share their resting pose and wake returns to neutral for every companion', () => {
  const sleep = DESKTOP_PET_MOTIONS.find(clip => clip.id === DesktopPetMotion.Doze)!;
  const wake = DESKTOP_PET_MOTIONS.find(clip => clip.id === DesktopPetMotion.Wake)!;
  for (const rig of rigs) {
    samePose(
      sample(rig, sleep.id, sleep.seconds, sleep.seconds),
      sample(rig, wake.id, 0, wake.seconds),
      rig.id,
    );
    samePose(
      sample(rig, DesktopPetMotion.Idle, 0, 4),
      sample(rig, wake.id, wake.seconds, wake.seconds),
      rig.id,
    );
  }
});

test('every frame keeps finite bounded joints without mutating shared geometry', () => {
  const initial = JSON.stringify(COMPANION_RIGS);
  for (const rig of rigs)
    for (const clip of DESKTOP_PET_MOTIONS)
      for (let frame = 0; frame <= clip.seconds * 30; frame++) {
        const pose = sample(rig, clip.id, frame / 30, clip.seconds);
        for (const value of Object.values(pose))
          if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
        expect(pose.stretch).toBeGreaterThan(0.85);
        expect(pose.stretch).toBeLessThan(1.15);
        expect(pose.blink).toBeGreaterThanOrEqual(0);
        expect(pose.blink).toBeLessThanOrEqual(1);
      }
  expect(JSON.stringify(COMPANION_RIGS)).toBe(initial);
});

test('each companion has distinct peek, grooming and dance joint choreography', () => {
  for (const id of [DesktopPetMotion.Peek, DesktopPetMotion.Preen, DesktopPetMotion.Dance]) {
    const signatures = rigs.map(rig =>
      JSON.stringify([0.23, 0.5, 0.78].map(progress => sample(rig, id, progress * 8, 8))),
    );
    expect(new Set(signatures).size, id).toBe(6);
  }
});
