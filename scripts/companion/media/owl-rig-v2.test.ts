import { createCanvas, loadImage } from '@napi-rs/canvas';
import { expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { OWL_RIG_V2_FRAMES, drawOwlRigV2 } from './owl-rig-v2.mjs';
import { sampleOwlMotionV2 } from './owl-motion-v2.mjs';
import { DesktopPetMotion } from '../../../src/shared/desktopPet/motionCatalog';

async function fixture() {
  const image = await loadImage(
    fileURLToPath(
      new URL('../../../src/renderer/assets/desktop-pet/xiaoyuan-atlas.png', import.meta.url),
    ),
  );
  const canvas = createCanvas(512, 512);
  Object.defineProperty(canvas, 'ownerDocument', {
    value: { createElement: () => createCanvas(1, 1) },
  });
  const context = canvas.getContext('2d');
  const original = createCanvas(512, 512).getContext('2d');
  original.drawImage(image, 0, 0, 512, 512, 0, 0, 512, 512);
  const pose = sampleOwlMotionV2(DesktopPetMotion.Idle, 0, 4, DesktopPetMotion);
  const bytes = (ctx: typeof context, rect: [number, number, number, number]) =>
    Buffer.from(ctx.getImageData(...rect).data);
  return { image, context, original, pose, bytes };
}

test('the neutral study preserves first-release face, material and toe pixels', async () => {
  const f = await fixture();
  drawOwlRigV2(f.context, f.image, OWL_RIG_V2_FRAMES, f.pose);
  for (const region of [
    [145, 140, 225, 120],
    [145, 300, 225, 145],
    [190, 468, 160, 28],
  ] as [number, number, number, number][])
    expect(f.bytes(f.context, region)).toEqual(f.bytes(f.original, region));
});

test('closed-eye animation changes the eyes while keeping the pointed beak and feet intact', async () => {
  const f = await fixture();
  drawOwlRigV2(f.context, f.image, OWL_RIG_V2_FRAMES, { ...f.pose, blink: 1 });
  expect(f.bytes(f.context, [170, 165, 65, 60])).not.toEqual(
    f.bytes(f.original, [170, 165, 65, 60]),
  );
  for (const region of [
    [250, 210, 28, 48],
    [190, 468, 160, 28],
  ] as [number, number, number, number][])
    expect(f.bytes(f.context, region)).toEqual(f.bytes(f.original, region));
});
