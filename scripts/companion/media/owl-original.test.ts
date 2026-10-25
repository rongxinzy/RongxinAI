import { createCanvas, loadImage } from '@napi-rs/canvas';
import { expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ORIGINAL_OWL_RIG, drawOriginalOwl } from './owl-original-rig.mjs';
import { sampleOriginalOwl } from './owl-original-motion.mjs';
import {
  DESKTOP_PET_MOTIONS,
  DesktopPetMotion,
} from '../../../src/shared/desktopPet/motionCatalog';

async function fixture() {
  const originalImage = await loadImage(
    fileURLToPath(
      new URL('../../../src/renderer/assets/desktop-pet/xiaoyuan-atlas.png', import.meta.url),
    ),
  );
  const repair = await loadImage(
    fileURLToPath(
      new URL(
        '../../../src/renderer/assets/desktop-pet/rigs/xiaoyuan-occlusion-v1.png',
        import.meta.url,
      ),
    ),
  );
  const image = createCanvas(1536, 2048);
  image.getContext('2d').drawImage(originalImage, 0, 0);
  image.getContext('2d').drawImage(repair, 0, 1024);
  const canvas = createCanvas(512, 512);
  Object.defineProperty(canvas, 'ownerDocument', {
    value: { createElement: () => createCanvas(1, 1) },
  });
  const context = canvas.getContext('2d');
  const original = createCanvas(512, 512).getContext('2d');
  original.drawImage(originalImage, 0, 0, 512, 512, 0, 0, 512, 512);
  return { image, context, original };
}

test('the original puppet preserves neutral facial and toe pixels without a replacement face', async () => {
  const f = await fixture();
  drawOriginalOwl(
    f.context,
    f.image,
    ORIGINAL_OWL_RIG,
    sampleOriginalOwl(DesktopPetMotion.Idle, 0, 4, DesktopPetMotion),
  );
  for (const region of [
    [145, 140, 225, 120],
    [190, 468, 160, 28],
  ] as [number, number, number, number][])
    expect(f.context.getImageData(...region).data).toEqual(f.original.getImageData(...region).data);
});

test('wings articulate while the canonical face and planted feet remain unchanged', async () => {
  const f = await fixture();
  const pose = sampleOriginalOwl(DesktopPetMotion.Idle, 0, 4, DesktopPetMotion);
  drawOriginalOwl(f.context, f.image, ORIGINAL_OWL_RIG, {
    ...pose,
    leftWing: 1.5,
    rightWing: -1.5,
  });
  for (const region of [
    [145, 140, 225, 120],
    [190, 468, 160, 28],
  ] as [number, number, number, number][])
    expect(f.context.getImageData(...region).data).toEqual(f.original.getImageData(...region).data);
  expect(f.context.getImageData(50, 285, 100, 100).data).not.toEqual(
    f.original.getImageData(50, 285, 100, 100).data,
  );
});

test('sleep hands off to wake without changing the sampled joint pose', () => {
  const sleep = sampleOriginalOwl(DesktopPetMotion.Doze, 10, 10, DesktopPetMotion);
  const wake = sampleOriginalOwl(DesktopPetMotion.Wake, 0, 6, DesktopPetMotion);
  for (const key of Object.keys(sleep))
    expect(wake[key as keyof typeof wake], key).toBeCloseTo(sleep[key as keyof typeof sleep], 10);
});

test('a blink closes one original iris progressively and never paints over the pointed beak', async () => {
  const f = await fixture();
  const pose = sampleOriginalOwl(DesktopPetMotion.Idle, 0, 4, DesktopPetMotion);
  const areas: number[] = [];
  const original = f.original.getImageData(170, 155, 70, 75).data;
  const blue = (pixels: Uint8ClampedArray, i: number) =>
    pixels[i + 2] > 60 && pixels[i + 2] > pixels[i] * 1.5 && pixels[i + 2] > pixels[i + 1] * 1.2;
  const irisMask = Array.from({ length: 70 * 75 }, (_, i) => blue(original, i * 4));
  const edgeMask = irisMask.map((_, i) => {
    const x = i % 70,
      y = Math.floor(i / 70);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (x + dx >= 0 && x + dx < 70 && y + dy >= 0 && y + dy < 75 && irisMask[i + dy * 70 + dx])
          return true;
    return false;
  });
  for (const blink of [0, 0.25, 0.5, 0.75, 1]) {
    drawOriginalOwl(f.context, f.image, ORIGINAL_OWL_RIG, { ...pose, blink });
    const pixels = f.context.getImageData(170, 155, 70, 75).data;
    let iris = 0,
      outside = 0;
    const unexpected: unknown[] = [];
    for (let i = 0; i < pixels.length; i += 4)
      if (blue(pixels, i)) {
        if (irisMask[i / 4]) iris++;
        if (!edgeMask[i / 4]) {
          outside++;
          unexpected.push({
            x: ((i / 4) % 70) + 170,
            y: Math.floor(i / 4 / 70) + 155,
            current: [...pixels.slice(i, i + 4)],
            original: [...original.slice(i, i + 4)],
          });
        }
      }
    // Track original iris locations: colour rounding at a feathered edge may move
    // the threshold by one pixel, but cannot create a second or shifted iris.
    expect(outside, JSON.stringify({ blink, unexpected })).toBe(0);
    areas.push(iris);
    expect(f.context.getImageData(250, 210, 28, 48).data).toEqual(
      f.original.getImageData(250, 210, 28, 48).data,
    );
  }
  expect(areas[0]).toBeGreaterThan(500);
  expect(areas.at(-1)).toBe(0);
  expect(areas).toEqual([...areas].sort((a, b) => b - a));
  expect(areas[2]).toBeLessThan(areas[0]);
  expect(areas[3]).toBeLessThan(areas[2]);
});

test('all authored clips keep visible pixels inside the 512px canvas at their sampled beats', async () => {
  const f = await fixture();
  const failures: string[] = [];
  for (const clip of DESKTOP_PET_MOTIONS)
    for (const p of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]) {
      drawOriginalOwl(
        f.context,
        f.image,
        ORIGINAL_OWL_RIG,
        sampleOriginalOwl(clip.id, p * clip.seconds, clip.seconds, DesktopPetMotion),
      );
      const pixels = f.context.getImageData(0, 0, 512, 512).data;
      let edge = 0;
      for (let y = 0; y < 512; y++)
        for (let x = 0; x < 512; x++)
          if (x < 4 || x > 507 || y < 4 || y > 507)
            edge = Math.max(edge, pixels[(y * 512 + x) * 4 + 3]);
      if (edge > 32) failures.push(`${clip.id}:${p}:${edge}`);
    }
  expect(failures).toEqual([]);
});
