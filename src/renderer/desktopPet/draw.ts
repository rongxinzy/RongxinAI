import { DESKTOP_PET_SIZE } from '../../shared/desktopPet/constants';
import type { DesktopPetAtlas } from './atlas';

const masks = new WeakMap<
  DesktopPetAtlas,
  { image: HTMLImageElement | undefined; values: Map<string, Uint8Array> }
>();

export function drawPetPose(
  target: CanvasRenderingContext2D,
  atlas: DesktopPetAtlas,
  index: number,
  scaleY = 1,
  facing = 1,
  rotate = 0,
  offsetX = 0,
  offsetY = 0,
): void {
  if (!atlas.image) return;
  const source = atlas.frame(index);
  // Reserve space for anticipation, ears, tail follow-through and leaps.
  const unit = (DESKTOP_PET_SIZE * 0.82) / source.unit;
  const height = source.height * unit;
  const width = source.width * unit;
  target.save();
  target.translate(DESKTOP_PET_SIZE / 2 + offsetX, DESKTOP_PET_SIZE - 12 + offsetY);
  target.rotate(rotate);
  target.scale(facing / Math.sqrt(scaleY), scaleY);
  target.drawImage(
    atlas.image,
    source.x,
    source.y,
    source.width,
    source.height,
    -width / 2,
    -height,
    width,
    height,
  );
  target.restore();
}

/** Cache active-pose envelopes; transparent space reserved for other poses stays click-through. */
export function petHitMask(
  atlas: DesktopPetAtlas,
  reduced: boolean,
  indices: number[],
): Uint8Array {
  let cache = masks.get(atlas);
  if (!cache || cache.image !== atlas.image) {
    cache = { image: atlas.image, values: new Map() };
    masks.set(atlas, cache);
  }
  const key = `${reduced}:${indices.join(',')}`;
  const cached = cache.values.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = DESKTOP_PET_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const alpha = new Uint8Array(DESKTOP_PET_SIZE * DESKTOP_PET_SIZE);
  if (!context) return alpha;
  if (reduced) {
    for (const index of indices) {
      drawPetPose(context, atlas, index);
      drawPetPose(context, atlas, index, 1, -1);
    }
  } else {
    for (const sprite of indices)
      for (const facing of [-1, 1])
        for (const rotate of [-0.16, 0, 0.16])
          for (const scale of [0.86, 1, 1.13])
            for (const [x, y] of [
              [-8, -18],
              [8, -18],
              [-8, 6],
              [8, 6],
              [0, 0],
            ])
              drawPetPose(context, atlas, sprite, scale, facing, rotate, x, y);
  }
  const pixels = context.getImageData(0, 0, DESKTOP_PET_SIZE, DESKTOP_PET_SIZE).data;
  // Match the native hit threshold and discard accumulated subpixel alpha at the edge.
  for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3] > 32 ? 255 : 0;
  if (cache.values.size >= 32) cache.values.delete(cache.values.keys().next().value!);
  cache.values.set(key, alpha);
  return alpha;
}

export function drawPetMedia(
  target: CanvasRenderingContext2D,
  source: CanvasImageSource,
  scaleY = 1,
  facing = 1,
  rotate = 0,
  offsetX = 0,
  offsetY = 0,
): void {
  target.save();
  target.translate(DESKTOP_PET_SIZE / 2 + offsetX, DESKTOP_PET_SIZE - 12 + offsetY);
  target.rotate(rotate);
  target.scale(facing / Math.sqrt(scaleY), scaleY);
  target.drawImage(
    source,
    -DESKTOP_PET_SIZE / 2,
    -(DESKTOP_PET_SIZE - 12),
    DESKTOP_PET_SIZE,
    DESKTOP_PET_SIZE,
  );
  target.restore();
}

const mediaMasks = new WeakMap<HTMLImageElement, { source: string; value: Uint8Array }>();
/** Each decoded slot owns one mask. Reusing its image for a new clip invalidates the cache. */
export function petMediaHitMask(images: HTMLImageElement[]): Uint8Array {
  const combined = new Uint8Array(DESKTOP_PET_SIZE * DESKTOP_PET_SIZE);
  for (const image of images) {
    let cached = mediaMasks.get(image);
    if (cached?.source !== image.src) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = DESKTOP_PET_SIZE;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) continue;
      for (const facing of [-1, 1])
        for (const rotate of [-0.16, 0, 0.16])
          for (const scale of [0.86, 1, 1.13])
            for (const [x, y] of [
              [-8, -18],
              [8, -18],
              [-8, 6],
              [8, 6],
              [0, 0],
            ])
              drawPetMedia(context, image, scale, facing, rotate, x, y);
      const pixels = context.getImageData(0, 0, DESKTOP_PET_SIZE, DESKTOP_PET_SIZE).data;
      const value = new Uint8Array(combined.length);
      for (let index = 0; index < value.length; index++)
        value[index] = pixels[index * 4 + 3] > 32 ? 255 : 0;
      cached = { source: image.src, value };
      mediaMasks.set(image, cached);
    }
    for (let index = 0; index < combined.length; index++) combined[index] |= cached.value[index];
  }
  return combined;
}
