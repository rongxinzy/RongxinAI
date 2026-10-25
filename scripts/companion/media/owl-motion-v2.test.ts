import { expect, test } from 'vitest';
import { DesktopPetMotion } from '../../../src/shared/desktopPet/motionCatalog';
import { sampleOwlMotionV2 } from './owl-motion-v2.mjs';

test('the quality study keeps feet grounded and its loop has no joint discontinuity', () => {
  const first = sampleOwlMotionV2(DesktopPetMotion.Idle, 0, 4, DesktopPetMotion);
  const last = sampleOwlMotionV2(DesktopPetMotion.Idle, 4, 4, DesktopPetMotion);
  for (const key of Object.keys(first)) {
    const start = first[key as keyof typeof first];
    const end = last[key as keyof typeof last];
    if (typeof start === 'number' && typeof end === 'number')
      expect(Math.abs(start - end)).toBeLessThan(1e-10);
    else expect(end).toBe(start);
  }
  for (let frame = 0; frame < 120; frame++) {
    const pose = sampleOwlMotionV2(DesktopPetMotion.Idle, frame / 30, 4, DesktopPetMotion);
    expect([pose.x, pose.y]).toEqual([0, 0]);
    expect(Math.abs(pose.headAngle)).toBeLessThanOrEqual(0.035);
  }
});

test('one short blink fully closes at 30fps without leaving the owl asleep', () => {
  const frames = Array.from(
    { length: 120 },
    (_, frame) => sampleOwlMotionV2(DesktopPetMotion.Idle, frame / 30, 4, DesktopPetMotion).blink,
  );
  expect(frames.filter(blink => blink > 0).length).toBeLessThanOrEqual(6);
  expect(frames.some(blink => blink === 1)).toBe(true);
  expect(frames.at(-1)).toBe(0);
});
