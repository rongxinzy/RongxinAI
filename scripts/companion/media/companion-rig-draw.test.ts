import { createCanvas } from '@napi-rs/canvas';
import { expect, test } from 'vitest';
import { DesktopPetBuiltinId } from '../../../src/shared/desktopPet/catalog';
import { DesktopPetMotion } from '../../../src/shared/desktopPet/motionCatalog';
import { COMPANION_RIGS } from './companion-rigs.mjs';
import { sampleCompanionMotion } from './companion-motion.mjs';
import { drawCompanionRig } from './companion-rig-draw.mjs';

test('partial blinking reveals authored lids without crossfading a second pair of eyes', () => {
  const source = createCanvas(40, 20),
    paint = source.getContext('2d');
  paint.fillStyle = 'red';
  paint.fillRect(0, 0, 20, 20);
  paint.fillStyle = 'blue';
  paint.fillRect(20, 0, 20, 20);
  const canvas = createCanvas(512, 512),
    context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  const rig = { ...COMPANION_RIGS.youli, face: [0, 0, 100, 100], eyeBand: [0.2, 0.8] };
  const neutral = sampleCompanionMotion(
    DesktopPetMotion.Idle,
    0,
    4,
    DesktopPetMotion,
    rig,
    DesktopPetBuiltinId,
  );
  const pose = { ...neutral, headX: 0, headY: 0, headAngle: 0, blink: 0.5 };
  drawCompanionRig(context, source, { face: [0, 0, 20, 20], blink: [20, 0, 20, 20] }, pose, rig);
  const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
  expect(pixel(256, 222)).toEqual([255, 0, 0, 255]);
  expect(pixel(256, 197)).toEqual([0, 0, 0, 0]);
  expect(pixel(256, 180)).toEqual([255, 0, 0, 255]);
  drawCompanionRig(
    context,
    source,
    { face: [0, 0, 20, 20], blink: [20, 0, 20, 20] },
    { ...pose, blink: 1 },
    rig,
  );
  expect(pixel(256, 222)).toEqual([0, 0, 255, 255]);
});
